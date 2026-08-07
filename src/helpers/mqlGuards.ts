import { ErrorCodes, MongoDBError } from "../common/errors.js";

/**
 * Operators that execute server-side JavaScript. These can be used to run
 * arbitrary code on the MongoDB server and are therefore disallowed by default.
 */
const SERVER_SIDE_JS_OPERATORS = ["$where", "$function", "$accumulator"] as const;

type ServerSideJSOperator = (typeof SERVER_SIDE_JS_OPERATORS)[number];

/**
 * Recursively scans an arbitrary value (typically an aggregation pipeline or a
 * query filter) for the presence of any server-side JavaScript operator.
 *
 * @returns the name of the first server-side JavaScript operator found, or
 * `undefined` if none are present.
 */
function findServerSideJSOperator(value: unknown): ServerSideJSOperator | undefined {
    if (Array.isArray(value)) {
        return value.map((item) => findServerSideJSOperator(item)).find((operator) => operator !== undefined);
    }

    if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
            if (SERVER_SIDE_JS_OPERATORS.includes(key as ServerSideJSOperator)) {
                return key as ServerSideJSOperator;
            }

            const found = findServerSideJSOperator(nested);
            if (found) {
                return found;
            }
        }
    }

    return undefined;
}

/**
 * Throws a {@link MongoDBError} when the provided value contains any server-side
 * JavaScript operator. Use this to guard aggregate and export operations when
 * the `disableServerSideJs` configuration option is enabled.
 */
export function assertNoServerSideJS(value: unknown): void {
    const operator = findServerSideJSOperator(value);
    if (operator) {
        throw new MongoDBError(
            ErrorCodes.ForbiddenServerSideJS,
            `The use of server-side JavaScript operators (such as ${SERVER_SIDE_JS_OPERATORS.join(
                ", "
            )}) is disabled. The "${operator}" operator is not allowed. To enable it, set the "disableServerSideJs" configuration option to false.`
        );
    }
}

/**
 * The write operator of an aggregation stage, or `undefined` when the stage
 * does not write to a collection.
 */
function writeStageOperator(stage: Record<string, unknown>): "$out" | "$merge" | undefined {
    if ("$out" in stage) {
        return "$out";
    }

    if ("$merge" in stage) {
        return "$merge";
    }

    return undefined;
}

/**
 * Returns true when the given aggregation stage writes data to a collection,
 * i.e. it is a `$out` or `$merge` stage.
 */
export function isWriteStage(stage: Record<string, unknown>): boolean {
    return writeStageOperator(stage) !== undefined;
}

/** The collection a write stage targets, along with how it will write to it. */
export type WriteStageTarget = { namespace: string | undefined } & (
    | { operator: "$out" }
    | {
          operator: "$merge";
          /** The `whenMatched` mode, when the stage names one of the documented modes. */
          whenMatched?: string;
          /** The `whenNotMatched` mode, when the stage names one of the documented modes. */
          whenNotMatched?: string;
      }
);

/**
 * Describes the collections that the write stages of a pipeline target, so that
 * the user can be told what a `$out` or `$merge` is about to affect before it
 * runs.
 *
 * Only top-level stages are inspected, matching {@link isWriteStage}: `$out` and
 * `$merge` are not permitted inside sub-pipelines. MongoDB also requires them to
 * be the last stage, so in practice at most one target is returned; the array
 * shape means a malformed pipeline is still described in full rather than
 * partially.
 *
 * @param pipeline - The aggregation pipeline to inspect.
 * @param defaultDatabase - The database the aggregation runs against, used to
 * qualify stages that name only a collection.
 */
export function getWriteStageTargets(pipeline: Record<string, unknown>[], defaultDatabase: string): WriteStageTarget[] {
    const targets: WriteStageTarget[] = [];

    for (const stage of pipeline) {
        switch (writeStageOperator(stage)) {
            case "$out":
                targets.push({ operator: "$out", namespace: resolveNamespace(stage.$out, defaultDatabase) });
                break;
            case "$merge": {
                // The stage is either the target itself (`$merge: "coll"`) or a
                // document describing it. `whenMatched` also accepts a custom
                // update pipeline, which has no concise description, so only the
                // documented string modes are reported.
                const spec = isRecord(stage.$merge) ? stage.$merge : undefined;
                targets.push({
                    operator: "$merge",
                    namespace: resolveNamespace(spec ? spec.into : stage.$merge, defaultDatabase),
                    ...(typeof spec?.whenMatched === "string" ? { whenMatched: spec.whenMatched } : {}),
                    ...(typeof spec?.whenNotMatched === "string" ? { whenNotMatched: spec.whenNotMatched } : {}),
                });
                break;
            }
            case undefined:
                break;
        }
    }

    return targets;
}

/**
 * Resolves the target of a `$out` stage or the `into` of a `$merge` stage to a
 * fully qualified namespace. Returns `undefined` for any other shape, such as
 * the `{ s3: ... }` target supported by Atlas Data Federation.
 */
function resolveNamespace(target: unknown, defaultDatabase: string): string | undefined {
    if (typeof target === "string") {
        return `${defaultDatabase}.${target}`;
    }

    if (isRecord(target) && typeof target.coll === "string") {
        const database = typeof target.db === "string" ? target.db : defaultDatabase;
        return `${database}.${target.coll}`;
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
