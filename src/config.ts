import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageMetadata = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8");
const packageJson = JSON.parse(packageMetadata);

export const config = {
    atlasApiVersion: `2025-03-12`,
    version: packageJson.version,
    apiBaseURL: process.env.API_BASE_URL || "https://cloud.mongodb.com/",
    clientID: process.env.CLIENT_ID || "0oabtxactgS3gHIR0297",
    stateFile: process.env.STATE_FILE || path.resolve("./state.json"),
    projectID: process.env.PROJECT_ID,
    userAgent: `AtlasMCP/${packageJson.version} (${process.platform}; ${process.arch}; ${process.env.HOSTNAME || "unknown"})`,
};

export default config;
