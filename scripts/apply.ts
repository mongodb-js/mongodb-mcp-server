import fs from "fs/promises";
import { OpenAPIV3_1 } from "openapi-types";
import argv from "yargs-parser";

function findObjectFromRef<T>(obj: T | OpenAPIV3_1.ReferenceObject, openapi: OpenAPIV3_1.Document): T {
    const ref = (obj as OpenAPIV3_1.ReferenceObject).$ref;
    if (ref === undefined) {
        return obj as T;
    }
    const paramParts = ref.split("/");
    paramParts.shift(); // Remove the first part which is always '#'
    let foundObj: any = openapi; // eslint-disable-line @typescript-eslint/no-explicit-any
    while (true) {
        const part = paramParts.shift();
        if (!part) {
            break;
        }
        foundObj = foundObj[part];
    }
    return foundObj as T;
}

async function main() {
    const { spec, file } = argv(process.argv.slice(2));

    if (!spec || !file) {
        console.error("Please provide both --spec and --file arguments.");
        process.exit(1);
    }

    const specFile = (await fs.readFile(spec, "utf8")) as string;

    const operations: {
        path: string;
        method: string;
        operationId: string;
        requiredParams: boolean;
        tag: string;
        hasResponseBody: boolean;
    }[] = [];

    const openapi = JSON.parse(specFile) as OpenAPIV3_1.Document;
    for (const path in openapi.paths) {
        for (const method in openapi.paths[path]) {
            const operation: OpenAPIV3_1.OperationObject = openapi.paths[path][method];

            if (!operation.operationId || !operation.tags?.length) {
                continue;
            }

            let requiredParams = !!operation.requestBody;
            let hasResponseBody = false;
            for (const code in operation.responses) {
                try {
                    const httpCode = parseInt(code, 10);
                    if (httpCode >= 200 && httpCode < 300) {
                        const response = operation.responses[code];
                        const responseObject = findObjectFromRef(response, openapi);
                        if (responseObject.content) {
                            for (const contentType in responseObject.content) {
                                const content = responseObject.content[contentType];
                                hasResponseBody = !!content.schema;
                            }
                        }
                    }
                } catch {
                    continue;
                }
            }

            for (const param of operation.parameters || []) {
                const paramObject = findObjectFromRef(param, openapi);
                if (paramObject.in === "path") {
                    requiredParams = true;
                }
            }

            operations.push({
                path,
                method: method.toUpperCase(),
                operationId: operation.operationId || "",
                requiredParams,
                hasResponseBody,
                tag: operation.tags[0],
            });
        }
    }

    const operationOutput = operations
        .map((operation) => {
            const { operationId, method, path, requiredParams, hasResponseBody } = operation;
            return `async ${operationId}(options${requiredParams ? "" : "?"}: FetchOptions<operations["${operationId}"]>) {
    ${hasResponseBody ? `const { data } = ` : ``}await this.client.${method}("${path}", options);
    ${
        hasResponseBody
            ? `return data;
`
            : ``
    }}
`;
        })
        .join("\n");

    const templateFile = (await fs.readFile(file, "utf8")) as string;
    const templateLines = templateFile.split("\n");
    let outputLines: string[] = [];
    let addLines = true;
    for (const line of templateLines) {
        if (line.includes("DO NOT EDIT. This is auto-generated code.")) {
            addLines = !addLines;
            outputLines.push(line);
            if (!addLines) {
                outputLines.push(operationOutput);
            }
            continue;
        }
        if (addLines) {
            outputLines.push(line);
        }
    }
    const output = outputLines.join("\n");

    await fs.writeFile(file, output, "utf8");
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
