import fs from "fs/promises";

export async function detectContainerEnv(): Promise<boolean> {
    if (process.platform !== "linux") {
        return false; // we only support linux containers for now
    }

    if (process.env.container) {
        return true;
    }

    const exists = await Promise.all(
        ["/.dockerenv", "/run/.containerenv", "/var/run/.containerenv"].map(async (file) => {
            try {
                await fs.access(file);
                return true;
            } catch {
                return false;
            }
        })
    );

    return exists.includes(true);
}
