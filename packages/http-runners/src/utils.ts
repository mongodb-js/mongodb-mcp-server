export async function sleep(ms: number, { signal }: { signal: AbortSignal }): Promise<void> {
    return new Promise((resolve) => {
        let listener: (() => void) | undefined = undefined;
        const timeout = setTimeout(() => {
            if (listener) {
                signal.removeEventListener("abort", listener);
            }
            resolve();
        }, ms);
        listener = (): void => {
            clearTimeout(timeout);
            resolve();
        };

        signal.addEventListener("abort", listener, { once: true });
    });
}
