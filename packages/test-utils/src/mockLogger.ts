import { vi, type Mock } from "vitest";
import type { ICompositeLogger } from "@mongodb-js/mcp-types";

/**
 * A composite logger whose every method is a `vi.fn()` mock, plus conveniences
 * for asserting what was logged: it stands in for an {@link ICompositeLogger}
 * (via {@link MockLogger.asCompositeLogger} or {@link asCompositeLogger}) and
 * exposes all emitted log messages as one string (see
 * {@link MockLogger.allLogMessages}) so a test can assert a secret never
 * reached the logger.
 */
export type MockLogger = {
    log: Mock;
    info: Mock;
    error: Mock;
    debug: Mock;
    notice: Mock;
    warning: Mock;
    critical: Mock;
    alert: Mock;
    emergency: Mock;
    flush: Mock;
    addLogger: Mock;
    setAttribute: Mock;

    /** Casts this mock logger to the {@link ICompositeLogger} contract. */
    asCompositeLogger(): ICompositeLogger;

    /** Concatenates every emitted log message (across all levels) into one string. */
    allLogMessages(): string;
};

/**
 * Builds a {@link MockLogger} with every method mocked. `flush` resolves to an
 * empty array so it is safe to await.
 */
export function createMockLogger(): MockLogger {
    const logger: Partial<MockLogger> = {
        log: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        notice: vi.fn(),
        warning: vi.fn(),
        critical: vi.fn(),
        alert: vi.fn(),
        emergency: vi.fn(),
        flush: vi.fn().mockResolvedValue([]),
        addLogger: vi.fn(),
        setAttribute: vi.fn(),
    };

    logger.asCompositeLogger = (): ICompositeLogger => logger as unknown as ICompositeLogger;
    logger.allLogMessages = (): string =>
        (
            [
                logger.log,
                logger.info,
                logger.error,
                logger.debug,
                logger.notice,
                logger.warning,
                logger.critical,
                logger.alert,
                logger.emergency,
            ] as Mock[]
        )
            .flatMap((fn) => fn.mock.calls.map((call) => JSON.stringify(call)))
            .join(" ");

    return logger as MockLogger;
}

/** Casts a {@link MockLogger} so it satisfies the {@link ICompositeLogger} contract. */
export function asCompositeLogger(logger: MockLogger): ICompositeLogger {
    return logger.asCompositeLogger();
}
