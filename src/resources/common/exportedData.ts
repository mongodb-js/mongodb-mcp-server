import {
    CompleteResourceTemplateCallback,
    ListResourcesCallback,
    ReadResourceTemplateCallback,
    ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "../../server.js";
import logger, { LogId } from "../../common/logger.js";

export class ExportedData {
    private readonly name = "exported-data";
    private readonly description = "Data files exported in the current session.";
    private readonly uri = "exported-data://{exportName}";

    constructor(private readonly server: Server) {
        this.server.session.on("export-available", (uri) => {
            this.server.mcpServer.sendResourceListChanged();
            void this.server.mcpServer.server.sendResourceUpdated({
                uri,
            });
            this.server.mcpServer.sendResourceListChanged();
        });
        this.server.session.on("export-expired", () => {
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
            const sessionId = this.server.session.sessionId;
            if (!sessionId) {
                // Note that we don't throw error here because this is a
                // non-critical path and safe to return the most harmless value.

                // TODO: log warn here
                return { resources: [] };
            }

            const sessionExports = this.server.exportsManager.listAvailableExports();
            return {
                resources: sessionExports.map(({ name, uri }) => ({
                    name: name,
                    description: this.exportNameToDescription(name),
                    uri: uri,
                    mimeType: "application/json",
                })),
            };
        } catch (error) {
            logger.error(
                LogId.exportedDataListError,
                "Error when listing exported data resources",
                error instanceof Error ? error.message : String(error)
            );
            return {
                resources: [],
            };
        }
    };

    private autoCompleteExportName: CompleteResourceTemplateCallback = (value) => {
        try {
            const sessionId = this.server.session.sessionId;
            if (!sessionId) {
                // Note that we don't throw error here because this is a
                // non-critical path and safe to return the most harmless value.

                // TODO: log warn here
                return [];
            }

            const sessionExports = this.server.exportsManager.listAvailableExports();
            return sessionExports.filter(({ name }) => name.startsWith(value)).map(({ name }) => name);
        } catch (error) {
            logger.error(
                LogId.exportedDataAutoCompleteError,
                "Error when autocompleting exported data",
                error instanceof Error ? error.message : String(error)
            );
            return [];
        }
    };

    private readResourceCallback: ReadResourceTemplateCallback = async (uri, { exportName }) => {
        try {
            const sessionId = this.server.session.sessionId;
            if (!sessionId) {
                throw new Error("Cannot retrieve exported data, session is not valid.");
            }

            if (typeof exportName !== "string") {
                throw new Error("Cannot retrieve exported data, exportName not provided.");
            }

            return {
                contents: [
                    {
                        uri: this.server.exportsManager.exportNameToResourceURI(exportName),
                        text: await this.server.exportsManager.readExport(exportName),
                        mimeType: "application/json",
                    },
                ],
            };
        } catch (error) {
            return {
                contents: [
                    {
                        uri:
                            typeof exportName === "string"
                                ? this.server.exportsManager.exportNameToResourceURI(exportName)
                                : this.uri,
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
