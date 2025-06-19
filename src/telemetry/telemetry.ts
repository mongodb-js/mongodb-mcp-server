import { Session } from "../session.js";
import { BaseEvent, CommonProperties } from "./types.js";
import { UserConfig } from "../config.js";
import logger, { LogId } from "../logger.js";
import { ApiClient } from "../common/atlas/apiClient.js";
import { MACHINE_METADATA } from "./constants.js";
import { EventCache } from "./eventCache.js";
import nodeMachineId from "node-machine-id";
import { getDeviceId } from "@mongodb-js/device-id";
import fs from "fs/promises";

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath, fs.constants.F_OK);
        return true; // File exists
    } catch (e: unknown) {
        if (
            e instanceof Error &&
            (
                e as Error & {
                    code: string;
                }
            ).code === "ENOENT"
        ) {
            return false; // File does not exist
        }
        throw e; // Re-throw unexpected errors
    }
}

async function isContainerized(): Promise<boolean> {
    if (process.env.container) {
        return true;
    }

    const exists = await Promise.all(["/.dockerenv", "/run/.containerenv", "/var/run/.containerenv"].map(fileExists));

    return exists.includes(true);
}

export class Telemetry {
    private deviceIdAbortController = new AbortController();
    private eventCache: EventCache;
    private getRawMachineId: () => Promise<string>;
    private getContainerEnv: () => Promise<boolean>;
    private cachedCommonProperties?: CommonProperties;
    private flushing: boolean = false;

    private constructor(
        private readonly session: Session,
        private readonly userConfig: UserConfig,
        {
            eventCache,
            getRawMachineId,
            getContainerEnv,
        }: {
            eventCache: EventCache;
            getRawMachineId: () => Promise<string>;
            getContainerEnv: () => Promise<boolean>;
        }
    ) {
        this.eventCache = eventCache;
        this.getRawMachineId = getRawMachineId;
        this.getContainerEnv = getContainerEnv;
    }

    static create(
        session: Session,
        userConfig: UserConfig,
        {
            eventCache = EventCache.getInstance(),
            getRawMachineId = () => nodeMachineId.machineId(true),
            getContainerEnv = isContainerized,
        }: {
            eventCache?: EventCache;
            getRawMachineId?: () => Promise<string>;
            getContainerEnv?: () => Promise<boolean>;
        } = {}
    ): Telemetry {
        const instance = new Telemetry(session, userConfig, {
            eventCache,
            getRawMachineId,
            getContainerEnv,
        });

        return instance;
    }

    public async close(): Promise<void> {
        this.deviceIdAbortController.abort();
        await this.flush();
    }

    /**
     * Emits events through the telemetry pipeline
     * @param events - The events to emit
     */
    public emitEvents(events: BaseEvent[]): void {
        void this.flush(events);
    }

    /**
     * Gets the common properties for events
     * @returns Object containing common properties for all events
     */
    private async getCommonProperties(): Promise<CommonProperties> {
        if (!this.cachedCommonProperties) {
            let deviceId: string | undefined;
            let containerEnv: boolean | undefined;
            try {
                await Promise.all([
                    getDeviceId({
                        getMachineId: () => this.getRawMachineId(),
                        onError: (reason, error) => {
                            switch (reason) {
                                case "resolutionError":
                                    logger.debug(LogId.telemetryDeviceIdFailure, "telemetry", String(error));
                                    break;
                                case "timeout":
                                    logger.debug(
                                        LogId.telemetryDeviceIdTimeout,
                                        "telemetry",
                                        "Device ID retrieval timed out"
                                    );
                                    break;
                                case "abort":
                                    // No need to log in the case of aborts
                                    break;
                            }
                        },
                        abortSignal: this.deviceIdAbortController.signal,
                    }).then((id) => {
                        deviceId = id;
                    }),
                    this.getContainerEnv().then((env) => {
                        containerEnv = env;
                    }),
                ]);
            } catch (error: unknown) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.debug(LogId.telemetryDeviceIdFailure, "telemetry", err.message);
            }
            this.cachedCommonProperties = {
                ...MACHINE_METADATA,
                mcp_client_version: this.session.agentRunner?.version,
                mcp_client_name: this.session.agentRunner?.name,
                session_id: this.session.sessionId,
                config_atlas_auth: this.session.apiClient.hasCredentials() ? "true" : "false",
                config_connection_string: this.userConfig.connectionString ? "true" : "false",
                is_container_env: containerEnv ? "true" : "false",
                device_id: deviceId,
            };
        }

        return this.cachedCommonProperties;
    }

    /**
     * Checks if telemetry is currently enabled
     * This is a method rather than a constant to capture runtime config changes
     *
     * Follows the Console Do Not Track standard (https://consoledonottrack.com/)
     * by respecting the DO_NOT_TRACK environment variable
     */
    public isTelemetryEnabled(): boolean {
        // Check if telemetry is explicitly disabled in config
        if (this.userConfig.telemetry === "disabled") {
            return false;
        }

        const doNotTrack = "DO_NOT_TRACK" in process.env;
        return !doNotTrack;
    }

    /**
     * Attempts to flush events through authenticated and unauthenticated clients
     * Falls back to caching if both attempts fail
     */
    public async flush(events?: BaseEvent[]): Promise<void> {
        if (!this.isTelemetryEnabled()) {
            logger.info(LogId.telemetryEmitFailure, "telemetry", `Telemetry is disabled.`);
            return;
        }

        if (this.flushing) {
            this.eventCache.appendEvents(events ?? []);
            process.nextTick(async () => {
                // try again if in the middle of a flush
                await this.flush();
            });
            return;
        }

        this.flushing = true;

        try {
            const cachedEvents = this.eventCache.getEvents();
            const allEvents = [...cachedEvents, ...(events ?? [])];
            if (allEvents.length <= 0) {
                this.flushing = false;
                return;
            }

            logger.debug(
                LogId.telemetryEmitStart,
                "telemetry",
                `Attempting to send ${allEvents.length} events (${cachedEvents.length} cached)`
            );

            await this.sendEvents(this.session.apiClient, allEvents);
            this.eventCache.clearEvents();
            logger.debug(
                LogId.telemetryEmitSuccess,
                "telemetry",
                `Sent ${allEvents.length} events successfully: ${JSON.stringify(allEvents, null, 2)}`
            );
        } catch (error: unknown) {
            logger.debug(
                LogId.telemetryEmitFailure,
                "telemetry",
                `Error sending event to client: ${error instanceof Error ? error.message : String(error)}`
            );
            this.eventCache.appendEvents(events ?? []);
            process.nextTick(async () => {
                // try again
                await this.flush();
            });
        }

        this.flushing = false;
    }

    /**
     * Attempts to send events through the provided API client
     */
    private async sendEvents(client: ApiClient, events: BaseEvent[]): Promise<void> {
        const commonProperties = await this.getCommonProperties();

        await client.sendEvents(
            events.map((event) => ({
                ...event,
                properties: { ...commonProperties, ...event.properties },
            }))
        );
    }
}
