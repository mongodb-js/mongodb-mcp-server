import type { WriteStageTarget } from "./mqlGuards.js";

/**
 * Builds the message shown to the user before an aggregation containing a
 * `$out` or `$merge` stage runs. The two operators differ in blast radius --
 * `$out` replaces a collection wholesale while `$merge` modifies an existing
 * one -- so each is described in its own terms, naming the affected namespace
 * whenever it could be resolved.
 *
 * @param targets - The write stage targets, as returned by `getWriteStageTargets`.
 */
export function buildWriteStageConfirmationMessage(targets: WriteStageTarget[]): string {
    return `This aggregation contains ${targets.map(describeTarget).join(" and ")}. Proceed?`;
}

function describeTarget(target: WriteStageTarget): string {
    const collection = target.namespace ? `\`${target.namespace}\`` : "its target collection";

    switch (target.operator) {
        case "$out":
            return `a \`$out\` stage that will replace the entire contents of ${collection} with the pipeline output, permanently discarding any documents already there`;
        case "$merge": {
            const modes = [
                target.whenMatched !== undefined ? `whenMatched: ${target.whenMatched}` : undefined,
                target.whenNotMatched !== undefined ? `whenNotMatched: ${target.whenNotMatched}` : undefined,
            ].filter((mode) => mode !== undefined);

            return `a \`$merge\` stage that will write the pipeline output into ${collection}, modifying data already in that collection${modes.length > 0 ? ` (${modes.join(", ")})` : ""}`;
        }
    }
}
