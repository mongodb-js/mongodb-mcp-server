import { CompositeLogger } from "@mongodb-js/mcp-core";
import { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { beforeAll, describe, expect, it } from "vitest";

import { connectClient } from "./helpers/connectClient.js";
import { expectToolEvent } from "./helpers/expectToolEvent.js";
import { useBinaryServer } from "./helpers/useBinaryServer.js";
import { useMockTelemetry } from "./helpers/useMockTelemetry.js";

const SERVER_ARGS = ["--disabledTools", "atlas-local"];

let actualDeviceId: string;

describe("telemetry over the AI SDK MCP client", () => {
    const telemetry = useMockTelemetry();

    beforeAll(async () => {
        const deviceId = DeviceId.create(new CompositeLogger());
        actualDeviceId = await deviceId.get();
        deviceId.close();
    });

    describe("with telemetry enabled", () => {
        const server = useBinaryServer({ telemetry, args: SERVER_ARGS });

        it("delivers a success tool event for a tool call", async () => {
            const client = await connectClient(server);

            const result = await client.callTool({ name: "list-connections", arguments: {} });
            expect(result.isError).toBe(false);

            // Closing the client closes stdin, making the server flush telemetry on shutdown.
            await client.close();

            const event = await telemetry.waitForEvent(
                (e) => e.properties.component === "tool" && e.properties.command === "list-connections"
            );
            expectToolEvent(event, { command: "list-connections", result: "success", deviceId: actualDeviceId });
        });

        it("delivers a failure tool event for a tool call that fails", async () => {
            const client = await connectClient(server);

            const result = await client.callTool({
                name: "find",
                arguments: { database: "db", collection: "coll", connectionId: "missing" },
            });
            expect(result.isError).toBe(true);

            await client.close();

            const event = await telemetry.waitForEvent(
                (e) => e.properties.component === "tool" && e.properties.command === "find"
            );
            expectToolEvent(event, {
                command: "find",
                result: "failure",
                deviceId: actualDeviceId,
                extraKeys: ["connection_id"],
            });
            expect(event.properties.connection_id).toBe("missing");
        });

        it("delivers one tool event per tool call", async () => {
            const client = await connectClient(server);

            await client.callTool({ name: "list-connections", arguments: {} });
            await client.callTool({ name: "list-databases", arguments: { connectionId: "missing" } });
            await client.close();

            const listConnections = await telemetry.waitForEvent((e) => e.properties.command === "list-connections");
            const listDatabases = await telemetry.waitForEvent((e) => e.properties.command === "list-databases");
            expectToolEvent(listConnections, {
                command: "list-connections",
                result: "success",
                deviceId: actualDeviceId,
            });
            expectToolEvent(listDatabases, {
                command: "list-databases",
                result: "failure",
                deviceId: actualDeviceId,
                extraKeys: ["connection_id"],
            });
            expect(listDatabases.properties.connection_id).toBe("missing");

            const toolEvents = telemetry.received.filter((e) => e.properties.component === "tool");
            expect(toolEvents).toHaveLength(2);
        });
    });

    describe("with telemetry disabled", () => {
        const server = useBinaryServer({ telemetry, args: ["--telemetry", "disabled", ...SERVER_ARGS] });

        it("does not deliver tool events", async () => {
            const client = await connectClient(server);

            const result = await client.callTool({ name: "list-connections", arguments: {} });
            expect(result.isError).toBe(false);

            await client.close();
            // Let the server shut down so any cached flush completes.
            await new Promise((resolve) => setTimeout(resolve, 1_000));

            expect(telemetry.received).toEqual([]);
        });
    });
});
