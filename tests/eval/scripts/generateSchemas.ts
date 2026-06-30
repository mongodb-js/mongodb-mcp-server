/**
 * Generate JSON Schemas from the eval's zod types so they can be set on
 * Braintrust datasets (the `input`/`expected` schema of a dataset).
 *
 * Run with `pnpm run eval:generate-schemas`. Writes one file per schema into
 * `tests/eval/dist/` and prints each path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RunEvalExpectedSchema, RunEvalInputSchema, RunEvalMetadataSchema } from "../lib/datasetTypes.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptDir, "..", "dist");
const SCHEMA_ID_BASE = "https://github.com/mongodb-js/mongodb-mcp-server/tests/eval/schemas";

const schemas = {
    "input.schema.json": RunEvalInputSchema,
    "expected.schema.json": RunEvalExpectedSchema,
    "metadata.schema.json": RunEvalMetadataSchema,
} as const;

mkdirSync(outDir, { recursive: true });

for (const [file, schema] of Object.entries(schemas)) {
    const outFile = join(outDir, file);
    const jsonSchema = {
        $id: `${SCHEMA_ID_BASE}/${file}`,
        ...z.toJSONSchema(schema),
    };
    writeFileSync(outFile, JSON.stringify(jsonSchema, null, 4) + "\n");
    console.log(`Wrote ${relative(process.cwd(), outFile)}`);
}
