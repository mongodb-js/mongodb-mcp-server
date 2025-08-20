import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";

const packageJsonSchema = z
    .object({
        version: z.string(),
    })
    .passthrough();

export function getServerVersion(): string | null {
    try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const pkgPath = resolve(__dirname, "..", "..", "package.json");

        const packageJson = packageJsonSchema.parse(JSON.parse(readFileSync(pkgPath, "utf-8")));
        return packageJson.version;
    } catch (err) {
        console.warn("Could not read package.json:", err);
        return null;
    }
}
