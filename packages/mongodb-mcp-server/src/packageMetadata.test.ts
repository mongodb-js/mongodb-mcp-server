import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "..");

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(packageRoot, file), "utf-8")) as T;

// https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
const REGISTRY_DESCRIPTION_MAX_LENGTH = 100;

describe("package metadata", () => {
    const packageJson = readJson<{ description: string }>("package.json");
    const serverJson = readJson<{ description: string }>("server.json");
    const dockerfile = readFileSync(join(packageRoot, "Dockerfile"), "utf-8");

    it("keeps the MCP Registry description in sync with package.json", () => {
        expect(serverJson.description).toBe(packageJson.description);
    });

    it("keeps the Docker image description in sync with package.json", () => {
        const label = /^LABEL description="(.*)"$/m.exec(dockerfile)?.[1];
        expect(label).toBe(packageJson.description);
    });

    it("fits within the MCP Registry description limit", () => {
        expect(packageJson.description.length).toBeGreaterThan(0);
        expect(packageJson.description.length).toBeLessThanOrEqual(REGISTRY_DESCRIPTION_MAX_LENGTH);
    });

    it("describes capabilities rather than repeating the server name", () => {
        expect(packageJson.description).not.toMatch(/^MongoDB (Model Context Protocol|MCP) Server$/);
    });
});
