/**
 * A class that manages timeouts for a callback function.
 * It is used to ensure that a callback function is called after a certain amount of time.
 * If the callback function is not called after the timeout, it will be called with an error.
 */
export class TimeoutManager {
    private timeoutId?: NodeJS.Timeout;

    /**
     * A callback function that is called when the timeout is reached.
     */
    public onerror?: (error: unknown) => void;

    /**
     * Creates a new TimeoutManager.
     * @param callback - A callback function that is called when the timeout is reached.
     * @param timeoutMS - The timeout in milliseconds.
     */
    constructor(
        private readonly callback: () => Promise<void> | void,
        private readonly timeoutMS: number
    ) {
        if (timeoutMS <= 0) {
            throw new Error("timeoutMS must be greater than 0");
        }
        this.reset();
    }

    /**
     * Clears the timeout.
     */
    clear() {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
    }

    /**
     * Runs the callback function.
     */
    private async runCallback() {
        if (this.callback) {
            try {
                await this.callback();
            } catch (error: unknown) {
                this.onerror?.(error);
            }
        }
    }

    /**
     * Resets the timeout.
     */
    reset() {
        this.clear();
        this.timeoutId = setTimeout(() => {
            void this.runCallback().finally(() => {
                this.timeoutId = undefined;
            });
        }, this.timeoutMS);
    }
}
