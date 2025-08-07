import {
    CompleteResourceTemplateCallback,
    ListResourcesCallback,
    ReadResourceTemplateCallback,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../server.js";
import { LogId } from "../../common/logger.js";

export class ExportedData {
    private readonly name = "exported-data";
    private readonly description = "Data files exported in the current session.";
    private readonly uri = "exported-data://{exportName}";

    constructor(private readonly server: Server) {
        this.server.session.exportsManager.on("export-available", (uri) => {
            this.server.mcpServer.sendResourceListChanged();
            void this.server.mcpServer.server.sendResourceUpdated({
                uri,
            });
        });
        this.server.session.exportsManager.on("export-expired", () => {
            this.server.mcpServer.sendResourceListChanged();
        });
    }

    public register(): void {
        this.server.mcpServer.registerResource(
            this.name,
            new ResourceTemplate(this.uri, {
                /**
                 * A few clients have the capability of listing templated
                 * resources as well and this callback provides support for that
                 * */
                list: this.listResourcesCallback,
                /**
                 * This is to provide auto completion when user starts typing in
                 * value for template variable, in our case, exportName */
                complete: {
                    exportName: this.autoCompleteExportName,
                },
            }),
            { description: this.description },
            this.readResourceCallback
        );
    }

    private listResourcesCallback: ListResourcesCallback = () => {
        try {
            return {
                resources: this.server.session.exportsManager.availableExports.map(({ name, uri }) => ({
                    name: name,
                    description: this.exportNameToDescription(name),
                    uri: uri,
                    mimeType: "application/json",
                })),
            };
        } catch (error) {
            this.server.session.logger.error({
                id: LogId.exportedDataListError,
                context: "Error when listing exported data resources",
                message: error instanceof Error ? error.message : String(error),
            });
            return {
                resources: [],
            };
        }
    };

    private autoCompleteExportName: CompleteResourceTemplateCallback = (value) => {
        try {
            return this.server.session.exportsManager.availableExports
                .filter(({ name }) => name.startsWith(value))
                .map(({ name }) => name);
        } catch (error) {
            this.server.session.logger.error({
                id: LogId.exportedDataAutoCompleteError,
                context: "Error when autocompleting exported data",
                message: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    };

    private readResourceCallback: ReadResourceTemplateCallback = async (url, { exportName }) => {
        try {
            if (typeof exportName !== "string") {
                throw new Error("Cannot retrieve exported data, exportName not provided.");
            }

            const { content, exportURI } = await this.server.session.exportsManager.readExport(exportName);

            return {
                contents: [
                    {
                        uri: exportURI,
                        text: content,
                        mimeType: "application/json",
                    },
                ],
            };
        } catch (error) {
            return {
                contents: [
                    {
                        uri: url.href,
                        text: `Error reading from ${this.uri}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    };

    private exportNameToDescription(exportName: string) {
        const match = exportName.match(/^(.+)\.(\d+)\.json$/);
        if (!match) return "Exported data for an unknown namespace.";

        const [, namespace, timestamp] = match;
        if (!namespace) {
            return "Exported data for an unknown namespace.";
        }

        if (!timestamp) {
            return `Export from ${namespace}.`;
        }

        return `Export from ${namespace} done on ${new Date(parseInt(timestamp)).toLocaleString()}`;
    }
}
