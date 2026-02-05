import { type ReactElement } from "react";
import { ListDatabases as LGListDatabases } from "@lg-mcp/embeddable-uis";
import { useRenderData } from "@lg-mcp/hooks";
import type { ListDatabasesOutput } from "../../../tools/mongodb/metadata/listDatabases.js";

export type Database = ListDatabasesOutput["databases"][number];

export const ListDatabases = (): ReactElement | null => {
    const { data, isLoading, error, darkMode } = useRenderData<ListDatabasesOutput>();

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error: {error}</div>;
    }

    if (!data?.databases) {
        return null;
    }

    return <LGListDatabases databases={data.databases} darkMode={darkMode} />;
};
