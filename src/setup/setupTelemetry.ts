import { randomUUID } from "crypto";
import { ApiClient } from "../common/atlas/apiClient.js";
import type { Keychain } from "../common/keychain.js";
import { NullLogger } from "../common/logging/index.js";
import type { UserConfig } from "../common/config/userConfig.js";
import { DeviceId } from "../helpers/deviceId.js";
import { Telemetry } from "../telemetry/telemetry.js";
import type {
    SetupCommand,
    SetupEvent,
    SetupEventProperties,
    TelemetryBoolSet,
    TelemetryResult,
} from "../telemetry/types.js";
import type { SkillsInstallOutcome } from "./installSkills.js";

/**
 * Context accumulated as the user progresses through the setup wizard. Each
 * step adds to it, and every emitted event carries the full context so each
 * event is independently queryable downstream.
 */
export type SetupTelemetryContext = Omit<
    SetupEventProperties,
    "command" | "setup_session_id" | "last_step" | "error_type" | "total_duration_ms"
>;

export const toBoolSet = (value: boolean | undefined): TelemetryBoolSet | undefined => {
    if (value === undefined) {
        return undefined;
    }

    return value ? "true" : "false";
};

/**
 * Per-run helper that owns the setup telemetry session: assigns the
 * `setup_session_id`, tracks wall-clock durations, and
 * accumulates context so every event carries the full set of known flags.
 *
 * One instance is constructed per `runSetup` invocation. Callers emit typed
 * events at each logical step and call {@link flush} before the process
 * exits so buffered events are best-effort sent.
 */
export class SetupTelemetry {
    private readonly setupSessionId: string = randomUUID();
    private readonly startedAt: number = Date.now();
    private stepStartedAt: number = this.startedAt;
    private lastStep: SetupCommand | undefined;
    private context: SetupTelemetryContext = {};

    /**
     * Builds a fully-wired {@link SetupTelemetry} for the setup CLI: a silent
     * logger (so telemetry's internal logging doesn't leak into the
     * interactive wizard), a fresh {@link DeviceId}, an unauthenticated
     * {@link ApiClient}, and a {@link Telemetry} instance.
     */
    public static create(config: UserConfig, keychain: Keychain): SetupTelemetry {
        const logger = new NullLogger();
        const deviceId = DeviceId.create(logger);
        const apiClient = new ApiClient({ baseUrl: config.apiBaseUrl }, logger);
        const telemetry = Telemetry.create({
            logger,
            deviceId,
            apiClient,
            keychain,
            enabled: config.telemetry !== "disabled",
        });
        return new SetupTelemetry(telemetry, deviceId);
    }

    /**
     * Direct construction is primarily for tests that want to inject a mock
     * telemetry pipeline. Production code should use {@link SetupTelemetry.create}.
     */
    public constructor(
        private readonly telemetry: Telemetry,
        private readonly deviceId: DeviceId
    ) {}

    /**
     * Merges new context values into the accumulated context. Subsequent
     * events will automatically carry the updated values.
     */
    public updateContext(patch: Partial<SetupTelemetryContext>): void {
        this.context = { ...this.context, ...patch };
    }

    /**
     * Emits a single setup event. `duration_ms` is computed from the time
     * elapsed since the previous step (or setup start), and `result`
     * defaults to "success" — callers pass "failure" only when the step's
     * own code path failed (e.g. writing the editor config threw).
     */
    private emit(
        command: SetupCommand,
        extra: Partial<SetupEventProperties> = {},
        result: TelemetryResult = "success"
    ): void {
        const now = Date.now();
        const event: SetupEvent = {
            timestamp: new Date(now).toISOString(),
            source: "mdbmcp",
            properties: {
                component: "setup",
                category: "setup",
                duration_ms: now - this.stepStartedAt,
                result,
                command,
                setup_session_id: this.setupSessionId,
                ...this.context,
                ...extra,
            },
        };

        this.telemetry.emitEvents([event]);

        this.stepStartedAt = now;
        this.lastStep = command;
    }

    public emitStarted(): void {
        this.emit("started");
    }

    public emitPrerequisitesChecked(props: {
        nodeVersionOk: boolean;
        platformSupported: boolean;
        hasDocker?: boolean;
    }): void {
        this.updateContext({
            node_version_ok: toBoolSet(props.nodeVersionOk),
            platform_supported: toBoolSet(props.platformSupported),
            has_docker: toBoolSet(props.hasDocker),
        });
        this.emit("prerequisites_checked");
    }

    public emitAiToolSelected(aiTool: string): void {
        this.updateContext({ ai_tool: aiTool });
        this.emit("ai_tool_selected");
    }

    public emitReadOnlySelected(isReadOnly: boolean): void {
        this.updateContext({ is_read_only: toBoolSet(isReadOnly) });
        this.emit("read_only_selected");
    }

    public emitConnectionStringEntered(props: {
        provided: boolean;
        tested: boolean;
        attempts: number;
        testResult?: TelemetryResult;
    }): void {
        this.updateContext({
            connection_string_provided: toBoolSet(props.provided),
            connection_string_tested: toBoolSet(props.tested),
            connection_test_attempts: props.attempts,
        });
        // If the user tested their connection string, surface the final
        // test result on this step event (success/failure). If they skipped
        // the test, the step itself still "succeeded" — the user chose not
        // to validate — so we default to success.
        this.emit("connection_string_entered", {}, props.testResult ?? "success");
    }

    public emitServiceAccountIdEntered(provided: boolean): void {
        this.updateContext({ service_account_id_provided: toBoolSet(provided) });
        this.emit("service_account_id_entered");
    }

    public emitServiceAccountSecretEntered(provided: boolean): void {
        this.updateContext({ service_account_secret_provided: toBoolSet(provided) });
        this.emit("service_account_secret_entered");
    }

    public emitCredentialsValidated(): void {
        this.emit("credentials_validated");
    }

    public emitEditorConfigured(props: {
        usedDefaultConfigPath: boolean;
        result: TelemetryResult;
        error?: unknown;
    }): void {
        this.updateContext({
            used_default_config_path: toBoolSet(props.usedDefaultConfigPath),
        });
        this.emit("editor_configured", props.error ? { error_type: errorName(props.error) } : {}, props.result);
    }

    public emitOpenConfigPrompted(props: { opened: boolean; result: TelemetryResult; error?: unknown }): void {
        this.updateContext({ opened_config_file: toBoolSet(props.opened) });
        this.emit("open_config_prompted", props.error ? { error_type: errorName(props.error) } : {}, props.result);
    }

    /**
     * Records the outcome of the agent-skills install step. Step-level
     * `result` is "failure" only when the install was actually attempted and
     * failed; "skipped" outcomes (user declined, env-skip, tool not supported)
     * count as success — the step itself completed cleanly.
     */
    public emitSkillsInstallPrompted(outcome: SkillsInstallOutcome): void {
        const patch: Partial<SetupTelemetryContext> = {
            skills_install_status: outcome.status,
        };
        if (outcome.status === "skipped") {
            patch.skills_skip_reason = outcome.reason;
        } else {
            // installed or failed — both can carry scope
            if (outcome.scope !== undefined) {
                patch.skills_install_scope = outcome.scope;
            }
            if (outcome.status === "failed") {
                patch.skills_install_exit_code = outcome.exitCode;
            }
        }
        this.updateContext(patch);
        this.emit("skills_install_prompted", {}, outcome.status === "failed" ? "failure" : "success");
    }

    public emitCompleted(): void {
        this.emit("completed", { total_duration_ms: Date.now() - this.startedAt });
    }

    /**
     * Emits a cancellation event (e.g. the user hit Ctrl+C). The `result` is
     * "success" because the cancellation itself was handled gracefully — the
     * distinct `command: "cancelled"` is what analytics use to separate
     * abandoned runs from completed ones.
     */
    public emitCancelled(): void {
        this.emit("cancelled", {
            last_step: this.lastStep,
            total_duration_ms: Date.now() - this.startedAt,
        });
    }

    public emitFailed(error: unknown): void {
        this.emit(
            "failed",
            {
                last_step: this.lastStep,
                error_type: errorName(error),
                total_duration_ms: Date.now() - this.startedAt,
            },
            "failure"
        );
    }

    /**
     * Best-effort flush of any buffered events before the process exits. Also
     * closes the owned {@link DeviceId}.
     */
    public async flush(): Promise<void> {
        try {
            await this.telemetry.close();
        } catch {
            // Ignore errors from telemetry.close()
        } finally {
            this.deviceId.close();
        }
    }
}

const errorName = (error: unknown): string => {
    if (error && typeof error === "object" && "name" in error && typeof error.name === "string") {
        return error.name;
    }
    return "unknown";
};
