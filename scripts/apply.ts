import { createParseArgs } from "@mongosh/arg-parser/arg-parser";
import fs from "fs/promises";
import type { OpenAPIV3_1 } from "openapi-types";
import z4 from "zod/v4";

function analyzeSuccessResponse(
    operation: OpenAPIV3_1.OperationObject,
    openapi: OpenAPIV3_1.Document
): {
    hasResponseBody: boolean;
    acceptOverride: string | undefined;
    /** `#/components/schemas/<key>` segment; return type uses `components['schemas'][key]`. */
    responseBodySchemaKey: string | undefined;
} {
    let hasResponseBody = false;
    let acceptOverride: string | undefined;
    let responseBodySchemaKey: string | undefined;

    for (const code in operation.responses ?? {}) {
        try {
            const httpCode = Number.parseInt(code, 10);
            if (!Number.isFinite(httpCode) || httpCode < 200 || httpCode >= 300) {
                continue;
            }
            const responses = operation.responses ?? {};
            const responseObject = findObjectFromRef(responses[code], openapi) as OpenAPIV3_1.ResponseObject;
            if (!responseObject?.content) {
                continue;
            }
            for (const contentType in responseObject.content) {
                const content = responseObject.content[contentType];
                if (content?.schema) {
                    hasResponseBody = true;
                }
                if (!contentType.endsWith("+json")) {
                    acceptOverride = contentType;
                }
            }
            if (responseBodySchemaKey !== undefined) {
                continue;
            }
            const contentTypes = Object.keys(responseObject.content);
            const preferred = contentTypes.find((ct) => ct.includes("json")) ?? contentTypes[0];
            const media = preferred ? responseObject.content[preferred] : undefined;
            const schema = media?.schema;
            if (schema && typeof schema === "object" && "$ref" in schema && typeof schema.$ref === "string") {
                const refMatch = /^#\/components\/schemas\/([^/]+)$/.exec(schema.$ref);
                if (refMatch?.[1] !== undefined) {
                    responseBodySchemaKey = refMatch[1];
                }
            }
        } catch {
            continue;
        }
    }

    return { hasResponseBody, acceptOverride, responseBodySchemaKey };
}

function findObjectFromRef<T>(obj: T | OpenAPIV3_1.ReferenceObject, openapi: OpenAPIV3_1.Document): T {
    const ref = (obj as OpenAPIV3_1.ReferenceObject).$ref;
    if (ref === undefined) {
        return obj as T;
    }
    const paramParts = ref.split("/");
    paramParts.shift(); // Remove the first part which is always '#'

    let foundObj: Record<string, unknown> = openapi;
    while (true) {
        const part = paramParts.shift();
        if (!part) {
            break;
        }

        foundObj = foundObj[part] as Record<string, unknown>;
    }
    return foundObj as T;
}

async function main(): Promise<void> {
    const {
        parsed: { spec, file },
    } = createParseArgs({ schema: z4.object({ spec: z4.string(), file: z4.string() }) })({
        args: process.argv.slice(2),
    });

    if (!spec || !file) {
        console.error("Please provide both --spec and --file arguments.");
        process.exit(1);
    }

    const specFile = await fs.readFile(spec, "utf8");

    const operations: {
        path: string;
        method: string;
        operationId: string;
        methodName: string;
        requiredParams: boolean;
        tag: string;
        hasResponseBody: boolean;
        acceptOverride: string | undefined;
        responseBodySchemaKey: string | undefined;
    }[] = [];

    const openapi = JSON.parse(specFile) as OpenAPIV3_1.Document;
    for (const pathKey in openapi.paths) {
        for (const methodKey in openapi.paths[pathKey]) {
            // @ts-expect-error This is a workaround for the OpenAPI types
            const operation = openapi.paths[pathKey][methodKey] as OpenAPIV3_1.OperationObject & {
                "x-xgen-operation-id-override": string;
            };

            if (!operation.operationId || !operation.tags?.length) {
                continue;
            }

            let requiredParams = !!operation.requestBody;
            const { hasResponseBody, acceptOverride, responseBodySchemaKey } = analyzeSuccessResponse(
                operation,
                openapi
            );

            for (const param of operation.parameters || []) {
                const paramObject = findObjectFromRef(param, openapi);
                if (paramObject.in === "path") {
                    requiredParams = true;
                }
            }

            operations.push({
                path: pathKey,
                method: methodKey.toUpperCase(),
                methodName: operation["x-xgen-operation-id-override"] || operation.operationId || "",
                operationId: operation.operationId || "",
                requiredParams,
                hasResponseBody,
                acceptOverride,
                responseBodySchemaKey,
                tag: operation.tags?.[0] ?? "",
            });
        }
    }

    const operationOutput = operations
        .map((operation) => {
            const {
                methodName,
                operationId,
                method,
                path: opPath,
                requiredParams,
                hasResponseBody,
                acceptOverride,
                responseBodySchemaKey,
            } = operation;
            const optionsArg = acceptOverride
                ? `{ ...options, headers: { Accept: "${acceptOverride}", ...options?.headers } }`
                : `options`;
            const returnType =
                hasResponseBody && responseBodySchemaKey
                    ? `: Promise<components['schemas']['${responseBodySchemaKey}']>`
                    : "";
            const explicitReturnLint =
                hasResponseBody && responseBodySchemaKey
                    ? ""
                    : `// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
`;
            return `${explicitReturnLint}async ${methodName}(options${requiredParams ? "" : "?"}: FetchOptions<operations["${operationId}"]>)${returnType} {
    const { ${hasResponseBody ? `data, ` : ``}error, response } = await this.client.${method}("${opPath}", ${optionsArg});
    if (error) {
        throw ApiClientError.fromError(response, error);
    }
    ${
        hasResponseBody
            ? `return data;
`
            : ``
    }}
`;
        })
        .join("\n");

    const eslintDisableBlock = `/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */\n`;
    const eslintEnableBlock = `/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */`;
    const wrappedOperationOutput = eslintDisableBlock + operationOutput + eslintEnableBlock;

    const templateFile = await fs.readFile(file, "utf8");
    const templateLines = templateFile.split("\n");
    const outputLines: string[] = [];
    let addLines = true;
    for (const line of templateLines) {
        if (line.includes("DO NOT EDIT. This is auto-generated code.")) {
            addLines = !addLines;
            outputLines.push(line);
            if (!addLines) {
                outputLines.push(wrappedOperationOutput);
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
