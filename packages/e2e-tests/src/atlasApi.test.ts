import { describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expectDefined } from "@mongodb-js/mcp-test-utils";
import { hasAtlasApiCreds, useAtlasApiAgent } from "./utils/useAtlasApiAgent.js";
import { describeHarness } from "./utils/describeHarness.js";
import { waitForToolTelemetryEvent } from "./utils/telemetry.js";

// Read-only Atlas Admin API tools that need no cluster connection.
const ATLAS_API_TOOLS = ["atlas-list-projects", "atlas-list-orgs", "atlas-list-clusters"];

// Common failure phrases that must not leak into the transcript.
const ERROR_PATTERN = /\b(error|failed|forbidden|unable|unauthori[sz]\w*|\b403)\b/i;

/**
 * Atlas API e2e with no cluster. Opt-in: skips unless
 * `AGENT_E2E_ATLAS_CLIENT_ID`/`AGENT_E2E_ATLAS_CLIENT_SECRET` are set.
 */
describe.skipIf(!hasAtlasApiCreds())("Atlas API tools (no cluster)", () => {
    describeHarness(({ harness }) => {
        const { serverUrl, buildOptions, telemetryServer } = useAtlasApiAgent({ harness, telemetry: true });

        it("exposes Atlas tools to a direct MCP client without a connection string", async () => {
            const client = new Client({ name: "e2e-tests", version: "0.0.0" });
            const transport = new StreamableHTTPClientTransport(new URL(serverUrl()));
            await client.connect(transport);
            try {
                const { tools } = await client.listTools();
                const names = tools.map((tool) => tool.name);
                if (process.env.AGENT_E2E_DEBUG) {
                    console.log(`[atlas-api] server exposes ${names.length} tools`);
                }
                for (const name of ATLAS_API_TOOLS) {
                    expect(names).toContain(name);
                }
            } finally {
                await client.close();
            }
        });

        it("lists Atlas projects through the agent", { timeout: 180_000 }, async () => {
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a MongoDB MCP server named "mongo" through MCP function tools. `,
                        `Call the "atlas-list-projects" tool (it appears as "mcp__mongo__atlas-list-projects") `,
                        `to list the Atlas projects you can access. `,
                        `If there are none, say it. Otherwise, end your reply with exactly the line `,
                        `"PROJECT_COUNT: <n>" where <n> is the number of projects you can access. `,
                        `Use only the provided MCP tools - do not use any shell commands.`,
                    ].join("")
                );

                if (process.env.AGENT_E2E_DEBUG) {
                    console.log(`[atlas-api] list-projects reply:\n${turn.text}`);
                }

                expect(turn.toolCalls.some((tc) => tc.name === "atlas-list-projects")).toBe(true);
                expect(turn.text).not.toMatch(ERROR_PATTERN);
                expect(turn.text).toMatch(/PROJECT_COUNT:\s*\d+|no projects/i);

                const telemetry = telemetryServer();
                expectDefined(telemetry);
                const event = await waitForToolTelemetryEvent(telemetry, { command: "atlas-list-projects" });
                expect(event.properties).toMatchObject({
                    component: "tool",
                    command: "atlas-list-projects",
                    result: "success",
                });
            } finally {
                await session.dispose();
            }
        });

        it("lists Atlas organizations through the agent", { timeout: 180_000 }, async () => {
            const session = await harness.start(buildOptions());
            try {
                const turn = await session.prompt(
                    [
                        `You have access to a MongoDB MCP server named "mongo" through MCP function tools. `,
                        `Call the "atlas-list-orgs" tool (it appears as "mcp__mongo__atlas-list-orgs") `,
                        `to list the Atlas organizations you can access. `,
                        `If there are none, say it. Otherwise, end your reply with exactly the line `,
                        `"ORG_COUNT: <n>" where <n> is the number of organizations you can access. `,
                        `Use only the provided MCP tools - do not use any shell commands.`,
                    ].join("")
                );

                if (process.env.AGENT_E2E_DEBUG) {
                    console.log(`[atlas-api] list-orgs reply:\n${turn.text}`);
                }

                expect(turn.toolCalls.some((tc) => tc.name === "atlas-list-orgs")).toBe(true);
                expect(turn.text).not.toMatch(ERROR_PATTERN);
                expect(turn.text).toMatch(/ORG_COUNT:\s*\d+|no organizations/i);

                const telemetry = telemetryServer();
                expectDefined(telemetry);
                const event = await waitForToolTelemetryEvent(telemetry, { command: "atlas-list-orgs" });
                expect(event.properties).toMatchObject({
                    component: "tool",
                    command: "atlas-list-orgs",
                    result: "success",
                });
            } finally {
                await session.dispose();
            }
        });
    });
});
