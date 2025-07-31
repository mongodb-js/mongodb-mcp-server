import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugResource } from "../../../../src/resources/common/debug.js";
import { Session } from "../../../../src/common/session.js";
import { Server } from "../../../../src/server.js";
import { Telemetry } from "../../../../src/telemetry/telemetry.js";
import { config } from "../../../../src/common/config.js";

describe("debug resource", () => {
    let session = new Session({} as any);
    let server = new Server({ session } as any);
    let telemetry = Telemetry.create(session, { ...config, telemetry: "disabled" });

    let debugResource: DebugResource = new DebugResource(server, telemetry, { tag: "disconnected" });

    it("should be connected when a connected event happens", () => {
        debugResource.reduceApply("connected", undefined);
        const output = debugResource.toOutput();

        expect(output).toContain(`The user is connected to the MongoDB cluster.`);
    });

    it("should be disconnected when a disconnect event happens", () => {
        debugResource.reduceApply("disconnect", undefined);
        const output = debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster.`);
    });

    it("should be disconnected when a close event happens", () => {
        debugResource.reduceApply("close", undefined);
        const output = debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster.`);
    });

    it("should be disconnected and contain an error when an error event occurred", () => {
        debugResource.reduceApply("connection-error", "Error message from the server");
        const output = debugResource.toOutput();

        expect(output).toContain(`The user is not connected to a MongoDB cluster because of an error.`);
        expect(output).toContain(`<error>Error message from the server</error>`);
    });
});
