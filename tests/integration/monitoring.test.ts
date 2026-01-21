import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { StdioRunner } from "../../src/transports/stdio.js";
import { defaultTestConfig } from "./helpers.js";
import type {
    MonitoringEvents,
    MonitoringToolEvent,
    MonitoringServerEvent,
    MonitoringConnectionEvent,
} from "../../src/monitoring/types.js";
import { MonitoringEventNames } from "../../src/monitoring/types.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";

describe("Monitoring EventEmitter Interface", () => {
    describe("EventEmitter can be created and used", () => {
        it("should create a new EventEmitter with MonitoringEvents type", () => {
            const monitoring = new EventEmitter<MonitoringEvents>();
            expect(monitoring).toBeDefined();
            expect(monitoring).toBeInstanceOf(EventEmitter);
        });

        it("should allow registering listeners for monitoring events", () => {
            const monitoring = new EventEmitter<MonitoringEvents>();
            const listener = (event: MonitoringToolEvent): void => {
                expect(event).toBeDefined();
            };

            monitoring.on(MonitoringEventNames.TOOL_EXECUTED, listener);
            expect(monitoring.listenerCount(MonitoringEventNames.TOOL_EXECUTED)).toBe(1);
        });

        it("should allow emitting and receiving tool execution events", (done) => {
            const monitoring = new EventEmitter<MonitoringEvents>();

            monitoring.on(MonitoringEventNames.TOOL_EXECUTED, (event: MonitoringToolEvent) => {
                expect(event.type).toBe("tool");
                expect(event.tool_name).toBe("test-tool");
                expect(event.category).toBe("mongodb");
                expect(event.result).toBe("success");
                expect(event.duration_ms).toBeGreaterThan(0);
                done();
            });

            const testEvent: MonitoringToolEvent = {
                type: "tool",
                timestamp: new Date().toISOString(),
                duration_ms: 100,
                result: "success",
                tool_name: "test-tool",
                category: "mongodb",
            };

            monitoring.emit(MonitoringEventNames.TOOL_EXECUTED, testEvent);
        });

        it("should allow emitting and receiving server lifecycle events", (done) => {
            const monitoring = new EventEmitter<MonitoringEvents>();

            monitoring.on(MonitoringEventNames.SERVER_LIFECYCLE, (event: MonitoringServerEvent) => {
                expect(event.type).toBe("server");
                expect(event.command).toBe("start");
                expect(event.result).toBe("success");
                done();
            });

            const testEvent: MonitoringServerEvent = {
                type: "server",
                timestamp: new Date().toISOString(),
                duration_ms: 50,
                result: "success",
                command: "start",
            };

            monitoring.emit(MonitoringEventNames.SERVER_LIFECYCLE, testEvent);
        });

        it("should allow emitting and receiving connection lifecycle events", (done) => {
            const monitoring = new EventEmitter<MonitoringEvents>();

            monitoring.on(MonitoringEventNames.CONNECTION_LIFECYCLE, (event: MonitoringConnectionEvent) => {
                expect(event.type).toBe("connection");
                expect(event.command).toBe("connect");
                expect(event.result).toBe("success");
                expect(event.connection_type).toBe("scram");
                done();
            });

            const testEvent: MonitoringConnectionEvent = {
                type: "connection",
                timestamp: new Date().toISOString(),
                duration_ms: 200,
                result: "success",
                command: "connect",
                connection_type: "scram",
            };

            monitoring.emit(MonitoringEventNames.CONNECTION_LIFECYCLE, testEvent);
        });

        it("should allow removing event listeners", () => {
            const monitoring = new EventEmitter<MonitoringEvents>();
            const listener = (event: MonitoringToolEvent): void => {
                expect(event).toBeDefined();
            };

            monitoring.on(MonitoringEventNames.TOOL_EXECUTED, listener);
            expect(monitoring.listenerCount(MonitoringEventNames.TOOL_EXECUTED)).toBe(1);

            monitoring.off(MonitoringEventNames.TOOL_EXECUTED, listener);
            expect(monitoring.listenerCount(MonitoringEventNames.TOOL_EXECUTED)).toBe(0);
        });

        it("should support multiple listeners for the same event", () => {
            const monitoring = new EventEmitter<MonitoringEvents>();
            let listener1Called = false;
            let listener2Called = false;

            monitoring.on(MonitoringEventNames.TOOL_EXECUTED, () => {
                listener1Called = true;
            });

            monitoring.on(MonitoringEventNames.TOOL_EXECUTED, () => {
                listener2Called = true;
            });

            const testEvent: MonitoringToolEvent = {
                type: "tool",
                timestamp: new Date().toISOString(),
                duration_ms: 100,
                result: "success",
                tool_name: "test-tool",
                category: "mongodb",
            };

            monitoring.emit(MonitoringEventNames.TOOL_EXECUTED, testEvent);

            expect(listener1Called).toBe(true);
            expect(listener2Called).toBe(true);
        });
    });

    describe("EventEmitter injection in TransportRunner", () => {
        it("should allow injecting a custom EventEmitter via constructor", async () => {
            const customMonitoring = new EventEmitter<MonitoringEvents>();
            let eventReceived = false;

            customMonitoring.on(MonitoringEventNames.SERVER_LIFECYCLE, (event: MonitoringServerEvent) => {
                if (event.command === "start") {
                    eventReceived = true;
                }
            });

            const runner = new StdioRunner({
                userConfig: { ...defaultTestConfig, telemetry: "disabled" },
                monitoring: customMonitoring,
            });

            await runner.start();

            // Wait a bit for the event to be emitted
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(eventReceived).toBe(true);
            expect(runner.monitoring).toBe(customMonitoring);

            await runner.close();
        });

        it("should create a default EventEmitter when none is provided", async () => {
            const runner = new StdioRunner({
                userConfig: { ...defaultTestConfig, telemetry: "disabled" },
            });

            expect(runner.monitoring).toBeDefined();
            expect(runner.monitoring).toBeInstanceOf(EventEmitter);

            await runner.close();
        });
    });

    describeWithMongoDB("Monitoring events in real server operations", (integration) => {
        let runner: StdioRunner;
        const receivedEvents: {
            tool: MonitoringToolEvent[];
            server: MonitoringServerEvent[];
            connection: MonitoringConnectionEvent[];
        } = {
            tool: [],
            server: [],
            connection: [],
        };

        beforeEach(() => {
            receivedEvents.tool = [];
            receivedEvents.server = [];
            receivedEvents.connection = [];
        });

        afterEach(async () => {
            if (runner) {
                await runner.close();
            }
        });

        it("should emit server lifecycle events on start and stop", async () => {
            runner = new StdioRunner({
                userConfig: { ...defaultTestConfig, connectionString: integration.connectionString() },
            });

            runner.monitoring.on(MonitoringEventNames.SERVER_LIFECYCLE, (event: MonitoringServerEvent) => {
                receivedEvents.server.push(event);
            });

            await runner.start();

            // Wait for events to be emitted
            await new Promise((resolve) => setTimeout(resolve, 100));

            const startEvents = receivedEvents.server.filter((e) => e.command === "start");
            expect(startEvents.length).toBeGreaterThan(0);
            expect(startEvents[0]?.result).toBe("success");
            expect(startEvents[0]?.duration_ms).toBeGreaterThanOrEqual(0);

            await runner.close();

            // Wait for close events
            await new Promise((resolve) => setTimeout(resolve, 100));

            const stopEvents = receivedEvents.server.filter((e) => e.command === "stop");
            expect(stopEvents.length).toBeGreaterThan(0);
        });

        it("should emit connection lifecycle events", async () => {
            runner = new StdioRunner({
                userConfig: { ...defaultTestConfig, connectionString: integration.connectionString() },
            });

            runner.monitoring.on(MonitoringEventNames.CONNECTION_LIFECYCLE, (event: MonitoringConnectionEvent) => {
                receivedEvents.connection.push(event);
            });

            await runner.start();

            // Trigger a connection by accessing the server
            const server = runner["server"];
            if (server) {
                await server.session.connectionManager.connect();
            }

            // Wait for connection events
            await new Promise((resolve) => setTimeout(resolve, 500));

            const connectEvents = receivedEvents.connection.filter((e) => e.command === "connect");
            expect(connectEvents.length).toBeGreaterThan(0);
            expect(connectEvents[0]?.result).toBe("success");
            expect(connectEvents[0]?.duration_ms).toBeGreaterThanOrEqual(0);
        });

        it("should emit tool execution events when tools are called", async () => {
            runner = new StdioRunner({
                userConfig: { ...defaultTestConfig, connectionString: integration.connectionString() },
            });

            runner.monitoring.on(MonitoringEventNames.TOOL_EXECUTED, (event: MonitoringToolEvent) => {
                receivedEvents.tool.push(event);
            });

            await runner.start();

            // Execute a tool through the server
            const server = runner["server"];
            if (server) {
                const listDatabasesTool = server.tools.find((t) => t.name === "list-databases");
                if (listDatabasesTool) {
                    await listDatabasesTool.execute({});
                }
            }

            // Wait for tool events
            await new Promise((resolve) => setTimeout(resolve, 100));

            expect(receivedEvents.tool.length).toBeGreaterThan(0);
            const toolEvent = receivedEvents.tool[0];
            expect(toolEvent?.type).toBe("tool");
            expect(toolEvent?.tool_name).toBe("list-databases");
            expect(toolEvent?.category).toBe("mongodb");
            expect(toolEvent?.result).toBe("success");
            expect(toolEvent?.duration_ms).toBeGreaterThanOrEqual(0);
        });
    });
});

