import { beforeEach, describe, expect, it } from "vitest";
import { DebugResource } from "../../../../src/resources/common/debug.js";
import { Session } from "../../../../src/common/session.js";
import { Server } from "../../../../src/server.js";
import { Telemetry } from "../../../../src/telemetry/telemetry.js";
import { config } from "../../../../src/common/config.js";

describe("debug resource", () => {
    // eslint-disable-next-line
    const session = new Session({} as any);
    // eslint-disable-next-line
    const server = new Server({ session } as any);
    const telemetry = Telemetry.create(session, { ...config, telemetry: "disabled" });

    let debugResource: DebugResource = new DebugResource(server, telemetry);

    beforeEach(() => {
        debugResource = new DebugResource(server, telemetry);
    });

    it("should be connected when a connected event happens", () => {
        debugResource.reduceApply("connect", undefined);
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
