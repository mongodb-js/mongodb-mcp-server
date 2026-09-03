import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { CompleteResourceTemplateCallback, ListResourcesCallback, ReadResourceTemplateCallback } from "@modelcontextprotocol/server";
import { LogId } from "@mongodb-js/mcp-core";
import type { CliServer } from "@mongodb-js/mcp-cli";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";
import { formatUntrustedData } from "@mongodb-js/mcp-core";

export class ExportedData {
    private readonly name = "exported-data";
    private readonly description = "Data files exported through the export tool.";
    private readonly uri = "exported-data://{exportName}";
    private server: CliServer;

    constructor({ server }: { server: CliServer; transportRequest?: TransportRequestContext }) {
        this.server = server;
    }

    public register(server: CliServer): void {
        this.server = server;
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
        this.server.exportsManager.on("export-available", (uri: string): void => {
            this.server.sendResourceListChanged();
            this.server.sendResourceUpdated(uri);
        });
        this.server.exportsManager.on("export-expired", (): void => {
            this.server.sendResourceListChanged();
        });
    }

    private listResourcesCallback: ListResourcesCallback = () => {
        try {
            return {
                resources: this.server.exportsManager.availableExports.map(
                    ({ exportName, exportTitle, exportURI }) => ({
                        name: exportName,
                        description: exportTitle,
                        uri: exportURI,
                        mimeType: "application/json",
                    })
                ),
            };
        } catch (error) {
            this.server.logger.error({
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
            return this.server.exportsManager.availableExports
                .filter(({ exportName, exportTitle }) => {
                    const lcExportName = exportName.toLowerCase();
                    const lcExportTitle = exportTitle.toLowerCase();
                    const lcValue = value.toLowerCase();
                    return lcExportName.startsWith(lcValue) || lcExportTitle.includes(lcValue);
                })
                .map(({ exportName }) => exportName);
        } catch (error) {
            this.server.logger.error({
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

            const { content, docsTransformed } = await this.server.exportsManager.readExport(exportName);

            const text = formatUntrustedData(`The exported data contains ${docsTransformed} documents.`, content)
                .map((t) => t.text)
                .join("\n");

            return {
                contents: [
                    {
                        uri: url.href,
                        text,
                        mimeType: "application/json",
                    },
                ],
            };
        } catch (error) {
            return {
                contents: [
                    {
                        uri: url.href,
                        text: `Error reading ${url.href}: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    };
}
