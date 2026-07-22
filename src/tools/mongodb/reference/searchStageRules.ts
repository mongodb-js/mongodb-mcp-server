import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolBase } from "../../tool.js";
import type { OperationType, ToolCategory } from "../../tool.js";
import type { TelemetryToolMetadata } from "../../../telemetry/types.js";

export class SearchStageRulesTool extends ToolBase {
    static toolName = "get-search-stage-rules";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description =
        "Returns construction rules for MongoDB aggregation search stages ($search, $vectorSearch, $rankFusion, $scoreFusion, $rerank). Call this before building a pipeline that uses any of these stages.";
    public argsShape = {};

    // eslint-disable-next-line @typescript-eslint/require-await
    protected async execute(): Promise<CallToolResult> {
        return {
            content: [
                {
                    type: "text",
                    text: searchStageRules,
                },
            ],
        };
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

export const searchStageRules = `\
If the user has asked for a vector search, \`$vectorSearch\` **MUST** be the first stage
of the pipeline (or the first stage of a \`$unionWith\` sub-pipeline only when explicitly
combining unrelated result sets — for hybrid full-text + vector search, use \`$rankFusion\`
or \`$scoreFusion\` instead, see below).

If the user has asked for lexical/Atlas search, use \`$search\` instead of \`$text\`.
### Usage Rules for \`$vectorSearch\`
- **Index Type Detection:**
  Use the collection-indexes tool to determine if the target field has a classic vector index (type: 'vector') or an auto-embed index (type: 'autoEmbed').
- **Classic Vector Search (type: 'vector'):**
  Use 'queryVector' with embeddings as an array of numbers.
- **Auto-Embed Vector Search (type: 'autoEmbed'):**
  Use 'query' - MongoDB automatically generates embeddings at query time. Do NOT use 'queryVector' or 'embeddingParameters' for auto-embed indexes.
- **Unset embeddings:**
  Unless the user explicitly requests the embeddings, add an \`$unset\` stage **at the end of the pipeline** to remove the embedding field and avoid context limits. **The $unset stage in this situation is mandatory**.
- **Pre-filtering:**
  If the user requests additional filtering, include filters in \`$vectorSearch.filter\` only for pre-filter fields in the vector index.
  NEVER include fields in $vectorSearch.filter that are not part of the vector index.
- **Post-filtering:**
  For all remaining filters, add a $match stage after $vectorSearch.
- If unsure which fields are filterable, use the collection-indexes tool to determine valid prefilter fields.
- If no requested filters are valid prefilters, omit the filter key from $vectorSearch.

### Usage Rules for \`$search\`
- Include the index name, unless you know for a fact there's a default index. If unsure, use the collection-indexes tool to determine the index name.
- The \`$search\` stage supports multiple operators, such as 'autocomplete', 'text', 'geoWithin', and others. Choose the approprate operator based on the user's query. If unsure of the exact syntax, consult the MongoDB Atlas Search documentation, which can be found here: https://www.mongodb.com/docs/atlas/atlas-search/operators-and-collectors/

### Usage Rules for \`$rankFusion\` and \`$scoreFusion\` (Hybrid Search)
Use these stages when the user wants to combine full-text (\`$search\`) and vector
(\`$vectorSearch\`) retrieval into a single fused result set. **Prefer native
fusion over a \`$unionWith\` + \`$group\` workaround** — the workaround averages
incompatible score scales and produces wrong rankings.

**Which stage to use:**
- \`$rankFusion\` (MongoDB 8.0+) — Reciprocal Rank Fusion. The recommended default.
  Normalizes scores across incompatible scales automatically. No score tuning needed.
- \`$scoreFusion\` (MongoDB 8.2+) — Score-based fusion. Use when the user needs explicit
  per-pipeline weights, score normalisation (sigmoid / minMaxScaler), or a custom
  combination expression.

**Construction rules:**
- \`$rankFusion\` / \`$scoreFusion\` MUST be the first stage of the top-level pipeline.
- Sub-pipelines go inside \`input.pipelines\` as a named map (not an array). Each name
  must be non-empty, must not start with \`$\`, and must not contain \`.\` or null bytes.
- Allowed stages inside sub-pipelines: \`$search\`, \`$vectorSearch\`, \`$match\`, \`$sort\`,
  \`$geoNear\`, \`$skip\`, \`$limit\`. \`$project\` and \`$unset\` are NOT allowed inside sub-pipelines.
- Do field shaping (\`$project\` / \`$unset\`) only AFTER the fusion stage, at the root.
- Both a vectorSearch (or autoEmbed) index AND a search (lexical) index must exist on
  the collection. Use the collection-indexes tool to confirm both before running a hybrid query.
- Add a \`$limit\` stage after the fusion stage to cap the final result set.
- Add \`$unset\` at the end to remove embedding fields and avoid context bloat.

### Usage Rules for \`$rerank\` (Native Reranking)
Use these stages when the user wants to reorder a set of candidate documents using a cross-encoder reranker model.

**Construction rules:**
- \`$rerank\` can be any stage in the pipeline on an Atlas cluster running MongoDB 8.3 or higher.
- It is recommended to use \`$rerank\` after a sorted pipeline, e.g. \`$search\`, \`$vectorSearch\`, \`$rankFusion\`, \`$scoreFusion\`, or [\`$match\`, \`$sort\`].
- $rerank must be enabled via the Native Reranking Project Setting
- Set \`numDocsToRerank\` as the number of documents passed into \`$rerank\`. This will also limit the number of documents returned by \`$rerank\`
- Set \`path\` as a field name or an array of field names that exist in all documents. Use \`$match\` or \`$set\` before \`$rerank\` to validate no fields are missing.
- Add \`$addFields\` after \`$rerank\` to retrieve the reranker score.

**\`$rerank\` example (recommended default):**
\`\`\`javascript
[
  {
    $match: {
      description: { $exists: true },
      name: { $exists: true }
    }
  },
  {
    $sort: {
      lastUpdated: -1
    }
  },
  {
    $rerank: {
      query: {
        text: "query text including instructions"
      },
      model: "rerank-2.5",
      numDocsToRerank: 100,
      path: ["description", "name"]
    }
  },
  {
    $addFields: {
      rerankScore: { $meta: "score" }
    }
  }
]
\`\`\`
`;
