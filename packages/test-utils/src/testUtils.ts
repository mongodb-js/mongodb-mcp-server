import { beforeEach, afterEach } from "vitest";

export function createEnvironment(): {
    setVariable: (this: void, variable: string, value: unknown) => void;
    clearVariables(this: void): void;
} {
    const registeredEnvVariables: string[] = [];
    const originalEnv = { ...process.env };

    return {
        setVariable(variable: string, value: unknown): void {
            (process.env as Record<string, unknown>)[variable] = value;
            registeredEnvVariables.push(variable);
        },

        clearVariables(): void {
            for (const key of Object.keys(process.env)) {
                if (!(key in originalEnv)) {
                    delete process.env[key];
                }
            }
            Object.assign(process.env, originalEnv);
            registeredEnvVariables.length = 0;
        },
    };
}

/** Clears environment variables that start with the given prefix.
 *  Creates a clean environment for the test by saving the original values of the variables and restoring them after the test.
 */
export function useClearEnvironment(prefix: string): void {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = Object.create(null) as Record<string, string | undefined>;
        for (const key of Object.keys(process.env)) {
            if (key.startsWith(prefix)) {
                saved[key] = process.env[key];
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        Object.assign(process.env, saved);
    });
}
