export async function sleep(ms: number, { signal }: { signal: AbortSignal }): Promise<void> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            resolve();
        }, ms);

        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timeout);
                resolve();
            },
            { once: true }
        );
    });
}
