import { OpenAPIV3_1 } from "openapi-types";

async function readStdin() {
    return new Promise<string>((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("error", (err) => {
            reject(err);
        });
        process.stdin.on("data", (chunk) => {
            data += chunk;
        });
        process.stdin.on("end", () => {
            resolve(data);
        });
    });
}

function filterOpenapi(openapi: OpenAPIV3_1.Document): OpenAPIV3_1.Document {
    const allowedOperations = [
        "listProjects",
        "getProject",
        "createProject",
        "listClusters",
        "createCluster",
        "listClustersForAllProjects",
        "listProjectIpAccessLists",
        "createProjectIpAccessList",
    ];

    const filteredPaths = {};

    for (const path in openapi.paths) {
        const filteredMethods = {} as OpenAPIV3_1.PathItemObject;
        for (const method in openapi.paths[path]) {
            if (allowedOperations.includes(openapi.paths[path][method].operationId)) {
                filteredMethods[method] = openapi.paths[path][method];
            }
        }
        if (Object.keys(filteredMethods).length > 0) {
            filteredPaths[path] = filteredMethods;
        }
    }

    return { ...openapi, paths: filteredPaths };
}

async function main() {
    const openapiText = await readStdin();
    const openapi = JSON.parse(openapiText) as OpenAPIV3_1.Document;
    const filteredOpenapi = filterOpenapi(openapi);
    console.log(JSON.stringify(filteredOpenapi));
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
