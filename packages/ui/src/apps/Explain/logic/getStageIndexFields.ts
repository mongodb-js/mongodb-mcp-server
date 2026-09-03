/**
 * Portions ported from mongodb/compass @ adad060c5e
 * Source: packages/explain-plan-helper/src/utils.ts
 * Copyright MongoDB, Inc. Original license: SSPL-1.0 (MongoDB-internal reuse).
 *
 * Deviation: the original parses the EXPRESS_IXSCAN string `keyPattern` with
 * @mongodb-js/shell-bson-parser (the full shell BSON parser). To keep this
 * widget self-contained we do a best-effort JSON parse after quoting bare
 * object keys; on failure we return {}. This only affects the index `fields`
 * summary for EXPRESS stages — tree rendering is unaffected.
 */
import type { Stage } from "./ExplainPlan.js";

export function getStageIndexFields(stage: Stage): Record<string, unknown> {
    if (stage.stage === "EXPRESS_IXSCAN" && typeof stage.keyPattern === "string") {
        // For EXPRESS stages, the keyPattern is a string, which is not valid json.
        try {
            const result: unknown = JSON.parse(
                stage.keyPattern.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
            );
            return typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    return (stage.keyPattern as Record<string, unknown>) ?? {};
}
