import path from "node:path";

import { useClearEnvironment } from "@mongodb-js/mcp-test-utils";
import { beforeEach } from "vitest";

import type { MockTelemetryServer } from "../mocks/telemetryServer.js";

const projectRoot = path.resolve(import.meta.dirname, "../../../..");
const DEFAULT_SERVER_PATH = path.resolve(projectRoot, "packages/mongodb-mcp-server/dist/esm/index.js");

export type BinaryServerOptions = {
    /** Extra CLI arguments appended after the server binary path. */
    args?: string[];
    /** Environment overrides for the spawned process, layered on top of the cleared ambient env. */
    env?: Record<string, string>;
    /** Mock telemetry endpoint to point the server at; its `baseUrl` enables telemetry via `MDB_MCP_API_BASE_URL`. */
    telemetry?: MockTelemetryServer;
};

/** Everything needed to spawn the built MongoDB MCP server binary over stdio. */
export type BinaryServer = {
    command: string;
    args: string[];
    env: Record<string, string>;
};

/** Copies the process environment, dropping `undefined` values so it can be passed to `spawn`. */
export function environmentWith(overrides: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
            env[key] = value;
        }
    }
    return { ...env, ...overrides };
}

/**
 * Builds the stdio spawn config for the built server binary in `beforeEach`, clearing ambient
 * `MDB_MCP_*`/`DO_NOT_TRACK`. Passing `telemetry` wires its `baseUrl` and enables telemetry;
 * an explicit `--telemetry` in `args` overrides that (the result is a spawn config, not a process).
 */
export function useBinaryServer(options: BinaryServerOptions = {}): BinaryServer {
    useClearEnvironment("MDB_MCP_");
    useClearEnvironment("DO_NOT_TRACK");

    let current: BinaryServer | undefined;

    beforeEach(() => {
        const env: Record<string, string> = { ...options.env };
        if (options.telemetry) {
            env.MDB_MCP_API_BASE_URL = options.telemetry.baseUrl;
        }

        const args = [DEFAULT_SERVER_PATH];
        const hasTelemetryFlag = (options.args ?? []).some(
            (arg) => arg === "--telemetry" || arg.startsWith("--telemetry=")
        );
        if (!hasTelemetryFlag) {
            args.push("--telemetry", options.telemetry ? "enabled" : "disabled");
        }
        args.push(...(options.args ?? []));

        current = {
            command: process.execPath,
            args,
            env: environmentWith(env),
        };
    });

    const requireCurrent = (): BinaryServer => {
        if (!current) {
            throw new Error("Binary server config is only available during a test (built in beforeEach).");
        }
        return current;
    };

    return {
        get command(): string {
            return requireCurrent().command;
        },
        get args(): string[] {
            return requireCurrent().args;
        },
        get env(): Record<string, string> {
            return requireCurrent().env;
        },
    };
}
