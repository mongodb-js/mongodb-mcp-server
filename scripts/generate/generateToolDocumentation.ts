/**
 * This script generates tool documentation and updates:
 * - README.md tools list
 *
 * It uses the AllTools array from the tools module.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { AllTools } from "../../src/tools/index.js";
import { UIRegistry } from "../../src/ui/registry/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ToolInfo {
    name: string;
    description: string;
    category: string;
    operationType: string;
}

const overrides: Record<string, string> = {
    connect: "Connect to a MongoDB instance",
    "switch-connection": "Switch to a different MongoDB connection",
};

function extractToolInformation(): ToolInfo[] {
    const tools: ToolInfo[] = [];

    for (const ToolClass of AllTools) {
        // Create a minimal instance to access instance properties
        // We need to provide dummy params since we only need name and description
        const dummyParams = {
            category: ToolClass.category,
            operationType: ToolClass.operationType,
            session: {
                on: () => {},
                off: () => {},
                emit: () => false,
                connectionManager: null,
            } as never,
            config: {
                previewFeatures: [],
                vectorSearchDimensions: 1024,
                vectorSearchModel: "voyage-3-large",
                readOnly: false,
                disabledTools: [],
            } as never,
            telemetry: {
                emitEvents: () => {},
            } as never,
            elicitation: {
                requestConfirmation: () => Promise.resolve(false),
            } as never,
            uiRegistry: new UIRegistry(),
        };

        try {
            const instance = new ToolClass(dummyParams);

            const description = instance.description || "No description available";
            tools.push({
                name: instance.name,
                description: overrides[instance.name] || description,
                category: ToolClass.category,
                operationType: ToolClass.operationType,
            });
        } catch (error) {
            console.error(`Error instantiating tool ${ToolClass.name}:`, error);
        }
    }

    // Sort by category first, then by name
    return tools.sort((a, b) => {
        if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
        }
        return a.name.localeCompare(b.name);
    });
}

function generateReadmeToolsList(tools: ToolInfo[]): string {
    const sections: string[] = [];

    // Group tools by category
    const toolsByCategory: Record<string, ToolInfo[]> = {};
    for (const tool of tools) {
        if (!toolsByCategory[tool.category]) {
            toolsByCategory[tool.category] = [];
        }
        const categoryTools = toolsByCategory[tool.category];
        if (categoryTools) {
            categoryTools.push(tool);
        }
    }

    // Generate sections for each category
    const categoryTitles: Record<string, string> = {
        atlas: "MongoDB Atlas Tools",
        "atlas-local": "MongoDB Atlas Local Tools",
        mongodb: "MongoDB Database Tools",
    };

    const categoryOrder = ["atlas", "atlas-local", "mongodb"];

    for (const category of categoryOrder) {
        if (!toolsByCategory[category]) continue;

        sections.push(`#### ${categoryTitles[category]}\n`);

        for (const tool of toolsByCategory[category]) {
            sections.push(`- \`${tool.name}\` - ${tool.description}`);
        }

        // Add note for Atlas tools
        if (category === "atlas") {
            sections.push(
                "\nNOTE: atlas tools are only available when you set credentials on [configuration](#configuration) section.\n"
            );
        } else {
            sections.push("");
        }
    }

    return sections.join("\n");
}

function updateReadmeToolsList(tools: ToolInfo[]): void {
    const readmePath = join(__dirname, "..", "..", "README.md");
    let content = readFileSync(readmePath, "utf-8");

    const newToolsList = generateReadmeToolsList(tools);

    // Find and replace the tools list section
    // Match from "### Tool List" to the next "## " section
    const toolsRegex = /### Tool List\n\n([\s\S]*?)\n\n## 📄 Supported Resources/;
    const replacement = `### Tool List\n\n${newToolsList}\n## 📄 Supported Resources`;

    content = content.replace(toolsRegex, replacement);

    writeFileSync(readmePath, content, "utf-8");
    console.log("✓ Updated README.md tools list");
}

export function generateToolDocumentation(): void {
    const toolInfo = extractToolInformation();
    updateReadmeToolsList(toolInfo);
}
