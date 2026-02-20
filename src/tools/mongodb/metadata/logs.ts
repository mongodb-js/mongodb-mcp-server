import { MongoDBToolBase } from "../mongodbTool.js";
import type { ToolExecutionContext, ToolArgs, OperationType, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { z } from "zod";

const LogsOutputSchema = {
    logs: z.array(z.string()),
    totalLinesWritten: z.number(),
    shownCount: z.number(),
};

export type LogsOutput = z.infer<z.ZodObject<typeof LogsOutputSchema>>;

export class LogsTool extends MongoDBToolBase {
    static toolName = "mongodb-logs";
    public description = "Returns the most recent logged mongod events";
    public argsShape = {
        type: z
            .enum(["global", "startupWarnings"])
            .optional()
            .default("global")
            .describe(
                "The type of logs to return. Global returns all recent log entries, while startupWarnings returns only warnings and errors from when the process started."
            ),
        limit: z
            .number()
            .int()
            .max(1024)
            .min(1)
            .optional()
            .default(50)
            .describe("The maximum number of log entries to return."),
    };
    public override outputSchema = LogsOutputSchema;

    static operationType: OperationType = "metadata";

    protected async execute(
        { type, limit }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.runCommandWithCheck(
            "admin",
            {
                getLog: type,
            },
            {
                signal,
            }
        );

        // Trim ending newlines so that when we join the logs we don't insert empty lines
        // between messages.
        const logs = (result.log as string[]).slice(0, limit).map((l) => l.trimEnd());

        let message = `Found: ${result.totalLinesWritten} messages`;
        if (result.totalLinesWritten > limit) {
            message += ` (showing only the first ${limit})`;
        }
        return {
            content: formatUntrustedData(message, logs.join("\n")),
            structuredContent: {
                logs,
                totalLinesWritten: result.totalLinesWritten as number,
                shownCount: logs.length,
            },
        };
    }
}
