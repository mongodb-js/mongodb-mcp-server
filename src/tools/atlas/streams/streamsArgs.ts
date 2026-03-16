import { z } from "zod";

const ALLOWED_STREAMS_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const ALLOWED_STREAMS_NAME_ERROR = "Name can only contain ASCII letters, numbers, hyphens, and underscores";

export const StreamsArgs = {
    workspaceName: (): z.ZodString =>
        z
            .string()
            .min(1, "Workspace name is required")
            .max(64, "Workspace name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),

    processorName: (): z.ZodString =>
        z
            .string()
            .min(1, "Processor name is required")
            .max(64, "Processor name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),

    connectionName: (): z.ZodString =>
        z
            .string()
            .min(1, "Connection name is required")
            .max(64, "Connection name must be 64 characters or less")
            .regex(ALLOWED_STREAMS_NAME_REGEX, ALLOWED_STREAMS_NAME_ERROR),
};
