import { z } from "zod";

/**
 * Shared schema for the list-databases tool output.
 *
 * This schema is the single source of truth for the data contract between:
 * - The ListDatabasesTool (which returns structuredContent matching this schema)
 * - The ListDatabases UI component (which renders this data)
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
