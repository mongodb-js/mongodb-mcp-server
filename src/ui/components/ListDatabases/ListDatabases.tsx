import React from "react";
import { z } from "zod";
import { useRenderData } from "../../hooks/index.js";
import {
    Cell as LGCell,
    HeaderCell as LGHeaderCell,
    HeaderRow,
    Row as LGRow,
    Table,
    TableBody,
    TableHead,
} from "@leafygreen-ui/table";
import { tableStyles } from "./ListDatabases.styles.js";
import { ListDatabasesOutputSchema, type ListDatabasesOutput } from "./schema.js";

const HeaderCell = LGHeaderCell as React.FC<React.ComponentPropsWithoutRef<"th">>;
const Cell = LGCell as React.FC<React.ComponentPropsWithoutRef<"td">>;
const Row = LGRow as React.FC<React.ComponentPropsWithoutRef<"tr">>;

const ListDatabasesDataSchema = z.object(ListDatabasesOutputSchema);

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export const ListDatabases = () => {
    const { data, isLoading, error } = useRenderData<ListDatabasesOutput>();

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error: {error}</div>;
    }

    const validationResult = ListDatabasesDataSchema.safeParse(data);

    if (!validationResult.success) {
        console.error("[ListDatabases] Validation error:", validationResult.error);
        return null;
    }

    return (
        <Table className={tableStyles}>
            <TableHead>
                <HeaderRow>
                    <HeaderCell>DB Name</HeaderCell>
                    <HeaderCell>DB Size</HeaderCell>
                </HeaderRow>
            </TableHead>
            <TableBody>
                {data?.databases.map((db) => (
                    <Row key={db.name}>
                        <Cell>{db.name}</Cell>
                        <Cell>{formatBytes(db.size)}</Cell>
                    </Row>
                ))}
            </TableBody>
        </Table>
    );
};
