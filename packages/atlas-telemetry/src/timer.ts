/**
 * A reusable timer that wraps setTimeout with browser-safe unref support.
 * In Node.js, unref() prevents the timer from keeping the process alive.
 * In browsers (or environments without unref), the call is safely skipped.
 */
export class Timer {
    private timerId: ReturnType<typeof setTimeout> | undefined;

    schedule(callback: () => void, delayMs: number): void {
        this.cancel();
        this.timerId = setTimeout(callback, delayMs);
        if (typeof this.timerId?.unref === "function") {
            this.timerId.unref();
        }
    }

    cancel(): void {
        if (this.timerId !== undefined) {
            clearTimeout(this.timerId);
            this.timerId = undefined;
        }
    }

    get isScheduled(): boolean {
        return this.timerId !== undefined;
    }
}
