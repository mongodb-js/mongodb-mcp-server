import React from "react";
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
import { Body } from "@leafygreen-ui/typography";
import type { ListDatabasesOutput } from "../../../tools/mongodb/metadata/listDatabases.js";
import { AmountTextStyles } from "./ListDatabases.styles.js";

const HeaderCell = LGHeaderCell as React.FC<React.ComponentPropsWithoutRef<"th">>;
const Cell = LGCell as React.FC<React.ComponentPropsWithoutRef<"td">>;
const Row = LGRow as React.FC<React.ComponentPropsWithoutRef<"tr">>;

export type Database = ListDatabasesOutput["databases"][number];

interface ListDatabasesProps {
    databases?: Database[];
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export const ListDatabases = ({ databases: propDatabases }: ListDatabasesProps): React.ReactElement | null => {
    const { data: hookData, isLoading, error } = useRenderData<ListDatabasesOutput>();
    const databases = propDatabases ?? hookData?.databases;

    if (!propDatabases) {
        if (isLoading) {
            return <div>Loading...</div>;
        }

        if (error) {
            return <div>Error: {error}</div>;
        }
    }

    if (!databases) {
        return null;
    }

    return (
        <>
            <Body className={AmountTextStyles}>
                Your cluster has <strong>{databases.length} databases</strong>:
            </Body>
            <Table>
                <TableHead>
                    <HeaderRow>
                        <HeaderCell>Database</HeaderCell>
                        <HeaderCell>Size</HeaderCell>
                    </HeaderRow>
                </TableHead>
                <TableBody>
                    {databases.map((db) => (
                        <Row key={db.name}>
                            <Cell>{db.name}</Cell>
                            <Cell>{formatBytes(db.size)}</Cell>
                        </Row>
                    ))}
                </TableBody>
            </Table>
        </>
    );
};
