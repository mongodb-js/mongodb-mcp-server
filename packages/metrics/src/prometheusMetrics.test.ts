import { describe, it, expect } from "vitest";
import { Registry, Counter, Histogram } from "prom-client";
import { PrometheusMetrics } from "./prometheusMetrics.js";
import { createDefaultMetrics } from "./metricDefinitions.js";

describe("PrometheusMetrics", () => {
    describe("collectProcessMetrics", () => {
        it("does not register process/nodejs metrics when collectProcessMetrics is false (default)", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry });

            const output = await registry.metrics();
            expect(output).not.toMatch(/^# TYPE process_/m);
            expect(output).not.toMatch(/^# TYPE nodejs_/m);
        });

        it("registers process/nodejs metrics when collectProcessMetrics is true", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry, collectProcessMetrics: true });

            const output = await registry.metrics();
            expect(output).toMatch(/^# TYPE process_/m);
        });

        it("registers nodejs_* metrics when collectProcessMetrics is true", () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry, collectProcessMetrics: true });

            const metricNames = registry.getMetricsAsArray().map((m) => m.name);
            const hasNodejsMetric = metricNames.some((name) => name.startsWith("nodejs_"));
            expect(hasNodejsMetric).toBe(true);
        });
    });

    describe("custom metric definitions", () => {
        it("registers provided metrics in the registry", async () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            new PrometheusMetrics({ definitions: { ...createDefaultMetrics(), myCounter: counter }, registry });

            const output = await registry.metrics();
            expect(output).toContain("my_counter_total");
        });

        it("get() returns the metric by key", () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            const metrics = new PrometheusMetrics({
                definitions: { ...createDefaultMetrics(), myCounter: counter },
                registry,
            });

            expect(metrics.get("myCounter")).toBe(counter);
        });
    });

    describe("labels", () => {
        it("defaults to an empty, frozen record", () => {
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            expect(metrics.labels).toEqual({});
            expect(Object.isFrozen(metrics.labels)).toBe(true);
        });

        it("exposes the labels passed at construction", () => {
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name", "tenant"] as const,
                    registers: [],
                }),
            };
            const metrics = new PrometheusMetrics({ definitions, labels: { tenant: "acme" } });

            expect(metrics.labels).toEqual({ tenant: "acme" });
        });

        it("rejects an instance label the default definitions set per observation", () => {
            expect(
                () =>
                    new PrometheusMetrics({
                        definitions: createDefaultMetrics(),
                        labels: { reason: "idle_timeout" },
                    })
            ).toThrow(/reserved/);
            expect(
                () =>
                    new PrometheusMetrics({
                        definitions: createDefaultMetrics(),
                        labels: { tool_name: "spoofed" },
                    })
            ).toThrow(/reserved/);

            // `withLabels` can introduce one too, so it is checked as well.
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name"] as const,
                    registers: [],
                }),
            };
            const base = new PrometheusMetrics<typeof definitions>({ definitions });
            expect(() => base.withLabels({ reason: "idle_timeout" })).toThrow(/reserved/);
        });

        it("rejects a label with no value", () => {
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name", "tenant"] as const,
                    registers: [],
                }),
            };
            const base = new PrometheusMetrics<typeof definitions>({ definitions, labels: { tenant: "acme" } });

            // `InstanceLabels` is optional, so the type admits an explicit `undefined`.
            expect(
                () => new PrometheusMetrics<typeof definitions>({ definitions, labels: { tenant: undefined } })
            ).toThrow(/must have a value/);
            expect(() => base.withLabels({ tenant: undefined })).toThrow(/must have a value/);
        });

        it("withLabels() returns a sibling sharing definitions and registry", async () => {
            const registry = new Registry();
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name", "tenant", "region"] as const,
                    registers: [],
                }),
            };
            const base = new PrometheusMetrics<typeof definitions>({
                definitions,
                registry,
                labels: { tenant: "acme" },
            });
            const scoped = base.withLabels({ region: "eu" });

            expect(scoped.labels).toEqual({ tenant: "acme", region: "eu" });
            expect(scoped.registry).toBe(base.registry);
            expect(scoped.get("toolExecutionDuration")).toBe(base.get("toolExecutionDuration"));

            scoped.get("toolExecutionDuration").observe({ ...scoped.labels, tool_name: "find" }, 0.1);

            const output = await registry.metrics();
            expect(output).toContain('tenant="acme"');
            expect(output).toContain('region="eu"');
            expect(output).toContain('tool_name="find"');
        });

        it("withLabels() adds and overrides labels but cannot remove them", () => {
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name", "tenant", "region"] as const,
                    registers: [],
                }),
            };
            const base = new PrometheusMetrics<typeof definitions>({
                definitions,
                labels: { tenant: "acme" },
            });

            expect(base.withLabels({ region: "eu" }).labels).toEqual({ tenant: "acme", region: "eu" });
            expect(base.withLabels({ tenant: "other" }).labels).toEqual({ tenant: "other" });
            expect(base.withLabels({}).labels).toEqual({ tenant: "acme" });
        });

        it("rejects a label no definition declares", () => {
            const base = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            // @ts-expect-error -- no definition declares `tenant`
            const scoped = base.withLabels({ tenant: "acme" });

            // The guard is compile-time only: nothing rejects the label at runtime.
            expect(scoped.labels).toEqual({ tenant: "acme" });
        });
    });
});
