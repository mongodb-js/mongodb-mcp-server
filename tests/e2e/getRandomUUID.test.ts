import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("getRandomUUID()", () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const tmpDir = join(__dirname, "..", "tmp", "uuid-e2e");

    beforeAll(() => {
        mkdirSync(tmpDir, { recursive: true });
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should use Node.js crypto in normal Node.js environment", () => {
        const script = `
import { getRandomUUID } from "../../../dist/esm/helpers/getRandomUUID.js";
const uuid = getRandomUUID();
console.log(uuid);
`;

        const scriptPath = join(tmpDir, "test-node-crypto.mjs");
        writeFileSync(scriptPath, script);

        const result = execSync(`node ${scriptPath}`, {
            encoding: "utf-8",
            cwd: join(__dirname, "..", ".."),
        }).trim();

        expect(result).toMatch(UUID_REGEX);
    });
});
