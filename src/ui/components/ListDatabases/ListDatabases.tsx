import { type ReactElement } from "react";
import { useDarkMode, useRenderData } from "../../hooks/index.js";
import { Cell, HeaderCell, HeaderRow, Row, Table, TableBody, TableHead } from "@leafygreen-ui/table";
import { Body } from "@leafygreen-ui/typography";
import type { ListDatabasesOutput } from "../../../tools/mongodb/metadata/listDatabases.js";
import { AmountTextStyles, getContainerStyles } from "./ListDatabases.styles.js";

export type Database = ListDatabasesOutput["databases"][number];

interface ListDatabasesProps {
    databases?: Database[];
    darkMode?: boolean;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export const ListDatabases = ({
    databases: propDatabases,
    darkMode: darkModeProp,
}: ListDatabasesProps): ReactElement | null => {
    const darkMode = useDarkMode(darkModeProp);
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
        <div className={getContainerStyles(darkMode)}>
            <Body className={AmountTextStyles} darkMode={darkMode}>
                Your cluster has <strong>{databases.length} databases</strong>:
            </Body>
            <Table darkMode={darkMode}>
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
        </div>
    );
};
