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
        for (const item of value) {
            const found = findServerSideJSOperator(item);
            if (found) {
                return found;
            }
        }
        return undefined;
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
 * Returns true when the given aggregation stage writes data to a collection,
 * i.e. it is a `$out` or `$merge` stage.
 */
export function isWriteStage(stage: Record<string, unknown>): boolean {
    return "$out" in stage || "$merge" in stage;
}
