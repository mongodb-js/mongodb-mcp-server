import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { UserConfig } from "../common/config.js";
import { Telemetry } from "../telemetry/telemetry.js";
import type { SessionEvents } from "../common/session.js";
import { ReadResourceCallback, RegisteredResource, ResourceMetadata } from "@modelcontextprotocol/sdk/server/mcp.js";

type PayloadOf<K extends keyof SessionEvents> = SessionEvents[K][0];

type ResourceConfiguration = { name: string; uri: string; config: ResourceMetadata };

export function ReactiveResource<V, KE extends readonly (keyof SessionEvents)[]>(
    { name, uri, config: resourceConfig }: ResourceConfiguration,
    {
        initial,
        events,
    }: {
        initial: V;
        events: KE;
    }
) {
    type E = KE[number];

    abstract class NewReactiveResource {
        private registeredResource?: RegisteredResource;

        constructor(
            protected readonly server: Server,
            protected readonly session: Session,
            protected readonly config: UserConfig,
            protected readonly telemetry: Telemetry,
            private current?: V
        ) {
            this.current = initial;

            for (const event of events) {
                this.session.on(event, (...args: SessionEvents[typeof event]) => {
                    this.current = this.reduce(this.current, event, (args as unknown[])[0] as PayloadOf<typeof event>);
                    this.triggerUpdate();
                });
            }
        }

        public register(): void {
            this.registeredResource = this.server.mcpServer.registerResource(
                name,
                uri,
                resourceConfig,
                this.resourceCallback
            );
        }

        private resourceCallback: ReadResourceCallback = (uri) => ({
            contents: [
                {
                    text: this.toOutput(this.current),
                    mimeType: "application/json",
                    uri: uri.href,
                },
            ],
        });

        private triggerUpdate() {
            this.registeredResource?.update({});
            this.server.mcpServer.sendResourceListChanged();
        }

        abstract reduce(previous: V | undefined, eventName: E, ...event: PayloadOf<E>[]): V;
        abstract toOutput(state: V | undefined): string;
    }

    return NewReactiveResource;
}
