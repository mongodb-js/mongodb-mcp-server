import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setManagedTimeout } from "../../../src/common/managedTimeout.js";

describe("setManagedTimeout", () => {
    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("calls the timeout callback", () => {
        const callback = vi.fn();

        setManagedTimeout(callback, 1000);

        vi.advanceTimersByTime(1000);
        expect(callback).toHaveBeenCalled();
    });

    it("does not call the timeout callback if the timeout is cleared", () => {
        const callback = vi.fn();

        const timeout = setManagedTimeout(callback, 1000);

        vi.advanceTimersByTime(500);
        timeout.cancel();
        vi.advanceTimersByTime(500);

        expect(callback).not.toHaveBeenCalled();
    });

    it("does not call the timeout callback if the timeout is reset", () => {
        const callback = vi.fn();

        const timeout = setManagedTimeout(callback, 1000);

        vi.advanceTimersByTime(500);
        timeout.restart();
        vi.advanceTimersByTime(500);
        expect(callback).not.toHaveBeenCalled();
    });

    describe("if timeout is reset", () => {
        it("does not call the timeout callback within the timeout period", () => {
            const callback = vi.fn();

            const timeout = setManagedTimeout(callback, 1000);

            vi.advanceTimersByTime(500);
            timeout.restart();
            vi.advanceTimersByTime(500);
            expect(callback).not.toHaveBeenCalled();
        });
        it("calls the timeout callback after the timeout period", () => {
            const callback = vi.fn();

            const timeout = setManagedTimeout(callback, 1000);

            vi.advanceTimersByTime(500);
            timeout.restart();
            vi.advanceTimersByTime(1000);
            expect(callback).toHaveBeenCalled();
        });
    });
});
