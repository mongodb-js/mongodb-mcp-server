import { it, expect } from "vitest";
import type {
    ISession,
    ISessionStore,
    IKeychain,
    IElicitation,
    ToolClass,
    IToolRegistrar,
    ILoggerBase,
    ICompositeLogger,
    ITransportRunner,
    ApiClientLike,
    IMetrics,
    ITelemetry,
    IUIRegistry,
    IResources,
} from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Unused = [
    ISession,
    ISessionStore,
    IKeychain,
    IElicitation,
    ToolClass,
    IToolRegistrar,
    ILoggerBase,
    ICompositeLogger,
    ITransportRunner,
    ApiClientLike,
    IMetrics,
    ITelemetry,
    IUIRegistry,
    IResources,
];

it("exports all interfaces", () => {
    expect(true).toBe(true);
});
