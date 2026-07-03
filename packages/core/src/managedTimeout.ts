/**
 * Return type of setManagedTimeout.
 * Provides methods to restart or cancel the managed timeout.
 */
export type ManagedTimeout = {
    /** Restarts the timeout, clearing the current one and starting a new countdown. */
    restart(): void;
    /** Cancels the timeout, preventing the callback from executing. */
    cancel(): void;
};

/**
 * Creates a managed timeout that can be restarted or canceled.
 * Returns an object with restart() and cancel() methods.
 *
 * @param callback - Function to execute when the timeout expires
 * @param delay - Delay in milliseconds before the callback executes
 * @returns A ManagedTimeout object with restart() and cancel() methods
 */
export function setManagedTimeout(callback: () => void | Promise<void>, delay: number): ManagedTimeout {
    let timeoutId: NodeJS.Timeout | undefined;

    function start(): void {
        timeoutId = setTimeout(() => {
            void callback();
        }, delay);
    }

    function cancel(): void {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
    }

    start();

    return {
        restart: (): void => {
            cancel();
            start();
        },
        cancel,
    };
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
