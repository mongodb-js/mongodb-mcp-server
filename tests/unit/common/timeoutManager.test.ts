import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TimeoutManager } from "../../../src/common/timeoutManager.js";

describe("TimeoutManager", () => {
    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("calls the timeout callback", () => {
        const callback = vi.fn();

        new TimeoutManager(callback, 1000);

        vi.advanceTimersByTime(1000);
        expect(callback).toHaveBeenCalled();
    });

    it("does not call the timeout callback if the timeout is cleared", () => {
        const callback = vi.fn();

        const timeoutManager = new TimeoutManager(callback, 1000);

        vi.advanceTimersByTime(500);
        timeoutManager.clear();
        vi.advanceTimersByTime(500);

        expect(callback).not.toHaveBeenCalled();
    });

    it("does not call the timeout callback if the timeout is reset", () => {
        const callback = vi.fn();

        const timeoutManager = new TimeoutManager(callback, 1000);

        vi.advanceTimersByTime(500);
        timeoutManager.reset();
        vi.advanceTimersByTime(500);
        expect(callback).not.toHaveBeenCalled();
    });

    it("calls the onerror callback", () => {
        const onerrorCallback = vi.fn();

        const tm = new TimeoutManager(() => {
            throw new Error("test");
        }, 1000);
        tm.onerror = onerrorCallback;

        vi.advanceTimersByTime(1000);
        expect(onerrorCallback).toHaveBeenCalled();
    });

    describe("if timeout is reset", () => {
        it("does not call the timeout callback within the timeout period", () => {
            const callback = vi.fn();

            const timeoutManager = new TimeoutManager(callback, 1000);

            vi.advanceTimersByTime(500);
            timeoutManager.reset();
            vi.advanceTimersByTime(500);
            expect(callback).not.toHaveBeenCalled();
        });
        it("calls the timeout callback after the timeout period", () => {
            const callback = vi.fn();

            const timeoutManager = new TimeoutManager(callback, 1000);

            vi.advanceTimersByTime(500);
            timeoutManager.reset();
            vi.advanceTimersByTime(1000);
            expect(callback).toHaveBeenCalled();
        });
    });
});
