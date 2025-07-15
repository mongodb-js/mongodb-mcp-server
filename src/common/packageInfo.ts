import { readFileSync } from "fs";
import { join } from "path";

let packageJson: {
    version: string;
} = { version: "unknown" };

try {
    packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
        version: string;
    };
} catch (error) {
    console.error("Error getting package info", error);
}

export const packageInfo = {
    version: packageJson?.version,
    mcpServerName: "MongoDB MCP Server",
};
