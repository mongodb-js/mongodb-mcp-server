import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sleep } from "./utils.js";

describe("sleep", () => {
    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("resolves after the specified duration", async () => {
        const controller = new AbortController();
        const sleepPromise = sleep(1000, { signal: controller.signal });

        vi.advanceTimersByTime(1000);

        await expect(sleepPromise).resolves.toBeUndefined();
    });

    it("resolves immediately when aborted", async () => {
        const controller = new AbortController();
        const sleepPromise = sleep(1000, { signal: controller.signal });

        controller.abort();

        await expect(sleepPromise).resolves.toBeUndefined();
    });

    it("resolves early when aborted during sleep", async () => {
        const controller = new AbortController();
        const sleepPromise = sleep(1000, { signal: controller.signal });

        vi.advanceTimersByTime(500);
        controller.abort();

        await expect(sleepPromise).resolves.toBeUndefined();
    });

    it("does not resolve before the timeout if not aborted", async () => {
        const controller = new AbortController();
        let resolved = false;
        const sleepPromise = sleep(1000, { signal: controller.signal }).then(() => {
            resolved = true;
        });

        vi.advanceTimersByTime(500);
        expect(resolved).toBe(false);

        vi.advanceTimersByTime(500);
        await sleepPromise;
        expect(resolved).toBe(true);
    });
});
