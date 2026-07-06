import { type ReactElement } from "react";
import { ListDatabases as LGListDatabases } from "@lg-mcp/embeddable-uis";
import { useRenderData } from "@lg-mcp/hooks";

export interface ListDatabasesData {
    databases: Array<{ name: string; size: number }>;
    totalCount: number;
}

export const ListDatabases = (): ReactElement | null => {
    const { data, isLoading, error, darkMode } = useRenderData<ListDatabasesData>();

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
