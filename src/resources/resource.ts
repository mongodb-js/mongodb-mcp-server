import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { UserConfig } from "../common/config.js";
import { Telemetry } from "../telemetry/telemetry.js";
import type { SessionEvents } from "../common/session.js";
import { ReadResourceCallback, ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";
import logger, { LogId } from "../common/logger.js";

type PayloadOf<K extends keyof SessionEvents> = SessionEvents[K][0];

type ResourceConfiguration = { name: string; uri: string; config: ResourceMetadata };

export function ReactiveResource<Value, RelevantEvents extends readonly (keyof SessionEvents)[]>(
    { name, uri, config: resourceConfig }: ResourceConfiguration,
    {
        initial,
        events,
    }: {
        initial: Value;
        events: RelevantEvents;
    }
) {
    type SomeEvent = RelevantEvents[number];

    abstract class NewReactiveResource {
        protected readonly session: Session;
        protected readonly config: UserConfig;
        protected current: Value;

        constructor(
            protected readonly server: Server,
            protected readonly telemetry: Telemetry,
            current?: Value
        ) {
            this.current = current ?? initial;
            this.session = server.session;
            this.config = server.userConfig;

            for (const event of events) {
                this.session.on(event, (...args: SessionEvents[typeof event]) => {
                    this.reduceApply(event, (args as unknown[])[0] as PayloadOf<typeof event>);
                    void this.triggerUpdate();
                });
            }
        }

        public register(): void {
            this.server.mcpServer.registerResource(name, uri, resourceConfig, this.resourceCallback);
        }

        private resourceCallback: ReadResourceCallback = (uri) => ({
            contents: [
                {
                    text: this.toOutput(),
                    mimeType: "application/json",
                    uri: uri.href,
                },
            ],
        });

        private async triggerUpdate() {
            try {
                await this.server.mcpServer.server.sendResourceUpdated({ uri });
                this.server.mcpServer.sendResourceListChanged();
            } catch (error: unknown) {
                logger.warning(
                    LogId.serverClosed,
                    "Could not send the latest resources to the client.",
                    error as string
                );
            }
        }

        reduceApply(eventName: SomeEvent, ...event: PayloadOf<SomeEvent>[]): void {
            this.current = this.reduce(eventName, ...event);
        }

        protected abstract reduce(eventName: SomeEvent, ...event: PayloadOf<SomeEvent>[]): Value;
        abstract toOutput(): string;
    }

    return NewReactiveResource;
}
