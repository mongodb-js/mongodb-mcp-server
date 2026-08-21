import type { ITelemetry } from "@mongodb-js/mcp-types";

export class NoopTelemetry implements ITelemetry {
    isTelemetryEnabled(): boolean {
        return false;
    }

    emitEvents(): void {}

    async close(): Promise<void> {}
}
