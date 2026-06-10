import type { OpenAPIV3_1 } from "openapi-types";

async function readStdin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("error", (err) => {
            reject(err);
        });
        process.stdin.on("data", (chunk) => {
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            data += chunk;
        });
        process.stdin.on("end", () => {
            resolve(data);
        });
    });
}

function filterOpenapi(openapi: OpenAPIV3_1.Document): OpenAPIV3_1.Document {
    const allowedOperations = [
        "listGroups",
        "listOrgs",
        "getGroup",
        "createGroup",
        "deleteGroup",
        "listClusters",
        "listFlexClusters",
        "getCluster",
        "getFlexCluster",
        "createCluster",
        "createFlexCluster",
        "deleteCluster",
        "deleteFlexCluster",
        "updateCluster",
        "listClusterDetails",
        "upgradeGroupClusterTenantUpgrade",
        "tenantGroupFlexClusterUpgrade",
        "createDatabaseUser",
        "deleteDatabaseUser",
        "listDatabaseUsers",
        "listAccessListEntries",
        "createAccessListEntry",
        "deleteAccessListEntry",
        "getOrgGroups",
        "listAlerts",
        "listDropIndexSuggestions",
        "listClusterSuggestedIndexes",
        "listSchemaAdvice",
        "listSlowQueryLogs",
        "requestSampleDatasetLoad",
        "getSampleDatasetLoad",

        // Streams: Workspaces
        "listStreamWorkspaces",
        "createStreamWorkspace",
        "getStreamWorkspace",
        "updateStreamWorkspace",
        "deleteStreamWorkspace",
        "withStreamSampleConnections",

        // Streams: Connections
        "listStreamConnections",
        "createStreamConnection",
        "getStreamConnection",
        "updateStreamConnection",
        "deleteStreamConnection",

        // Streams: Processors
        "getStreamProcessors",
        "createStreamProcessor",
        "getStreamProcessor",
        "updateStreamProcessor",
        "deleteStreamProcessor",
        "startStreamProcessor",
        "startStreamProcessorWith",
        "stopStreamProcessor",

        // Streams: Networking
        "listPrivateLinkConnections",
        "createPrivateLinkConnection",
        "getPrivateLinkConnection",
        "deletePrivateLinkConnection",
        "deleteVpcPeeringConnection",
        "acceptVpcPeeringConnection",
        "rejectVpcPeeringConnection",
        "getAccountDetails",

        // Streams: Logs
        "downloadAuditLogs",
        "downloadOperationalLogs",
    ];

    // upgradeGroupClusterTenantUpgrade requires 2023-01-01 — the endpoint behaves differently
    // under 2025-03-12 (rejects direct FREE→M10, requires FLEX first).
    const acceptOverrides: Record<string, string> = {
        upgradeGroupClusterTenantUpgrade: "application/vnd.atlas.2023-01-01+json",
    };

    const filteredPaths = {};

    for (const path in openapi.paths) {
        const filteredMethods = {} as OpenAPIV3_1.PathItemObject;
        // @ts-expect-error This is a workaround for the OpenAPI types
        for (const [method, operation] of Object.entries(openapi.paths[path])) {
            const op = operation as OpenAPIV3_1.OperationObject & {
                "x-xgen-operation-id-override": string;
                "x-accept-override"?: string;
            };
            if (
                op.operationId &&
                (allowedOperations.includes(op.operationId) ||
                    allowedOperations.includes(op["x-xgen-operation-id-override"]))
            ) {
                const acceptOverride =
                    acceptOverrides[op.operationId] ?? acceptOverrides[op["x-xgen-operation-id-override"]];
                if (acceptOverride) {
                    op["x-accept-override"] = acceptOverride;
                }
                // @ts-expect-error This is a workaround for the OpenAPI types
                filteredMethods[method] = openapi.paths[path][method] as OpenAPIV3_1.OperationObject;
            }
        }
        if (Object.keys(filteredMethods).length > 0) {
            // @ts-expect-error This is a workaround for the OpenAPI types
            filteredPaths[path] = filteredMethods;
        }
    }

    return { ...openapi, paths: filteredPaths };
}

async function main(): Promise<void> {
    const openapiText = await readStdin();
    const openapi = JSON.parse(openapiText) as OpenAPIV3_1.Document;
    const filteredOpenapi = filterOpenapi(openapi);
    console.log(JSON.stringify(filteredOpenapi));
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
