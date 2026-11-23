import type { AvailableExport, CreateJSONExportParams } from "./exportsManager.js";

/**
 * An exports manager for embedders that do not register the `export` tool.
 *
 * Creating an export is not supported, so it rejects rather than reporting an
 * export the caller could not actually read.
 */
export class NoopExportsManager {
    public createJSONExport({ exportTitle }: CreateJSONExportParams): Promise<AvailableExport> {
        return Promise.reject(new Error(`Exporting "${exportTitle}" is not supported.`));
    }
}
