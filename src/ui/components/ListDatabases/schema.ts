import { z } from "zod";

/**
 * Shared schema for the list-databases tool output.
 */
export const ListDatabasesOutputSchema = {
    databases: z.array(
        z.object({
            name: z.string(),
            size: z.number(),
        })
    ),
    totalCount: z.number(),
};

/** Type derived from the output schema */
export type ListDatabasesOutput = z.infer<z.ZodObject<typeof ListDatabasesOutputSchema>>;
