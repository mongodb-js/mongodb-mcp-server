import { z } from "zod";
import { StreamsToolBase } from "./streamsToolBase.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { AtlasArgs } from "../../args.js";
import { ConnectionConfig, PrivateLinkConfig, StreamsArgs } from "./streamsArgs.js";
import { rejectInvalidConnectionConfig } from "./connectionConfigs.js";

const BuildResource = z.enum(["workspace", "connection", "processor", "privatelink"]);

const ConnectionType = z.enum([
    "Kafka",
    "Cluster",
    "S3",
    "Https",
    "AWSKinesisDataStreams",
    "AWSLambda",
    "SchemaRegistry",
    "Sample",
]);

const CloudProvider = z.enum(["AWS", "AZURE", "GCP"]);

interface FieldSchema {
    title: string;
    description: string;
}

type MissingField = FieldSchema & { key: string };

const KAFKA_FIELDS = {
    bootstrapServers: {
        title: "Bootstrap Servers",
        description: "Comma-separated broker addresses (e.g. 'broker1:9092,broker2:9092')",
    },
    mechanism: {
        title: "Authentication Mechanism",
        description: "SASL mechanism: 'PLAIN', 'SCRAM-256', or 'SCRAM-512'",
    },
    username: {
        title: "Username",
        description: "SASL username for Kafka authentication",
    },
    password: {
        title: "Password",
        description: "SASL password for Kafka authentication",
    },
    protocol: {
        title: "Security Protocol",
        description: "Security protocol: 'SASL_SSL', 'SASL_PLAINTEXT', or 'SSL'",
    },
} as const satisfies Record<string, FieldSchema>;

const CLUSTER_FIELDS = {
    clusterName: {
        title: "Cluster Name",
        description: "Name of an Atlas cluster in this project (use `atlas-list-clusters` to see available clusters)",
    },
} as const satisfies Record<string, FieldSchema>;

const AWS_FIELDS = {
    roleArn: {
        title: "AWS IAM Role ARN",
        description:
            "IAM role ARN registered in this Atlas project via Cloud Provider Access " +
            "(e.g. 'arn:aws:iam::123456789:role/my-role'). " +
            "Ask the user for this value — it can be found in: Atlas UI → Project Settings → Cloud Provider Access.",
    },
} as const satisfies Record<string, FieldSchema>;

const SCHEMA_REGISTRY_FIELDS = {
    schemaRegistryUrl: {
        title: "Schema Registry URL",
        description: "Schema Registry endpoint URL (e.g. 'https://schema-registry.example.com')",
    },
    username: {
        title: "Username",
        description: "Username for Schema Registry authentication",
    },
    password: {
        title: "Password",
        description: "Password for Schema Registry authentication",
    },
} as const satisfies Record<string, FieldSchema>;

const HTTPS_FIELDS = {
    url: {
        title: "Endpoint URL",
        description: "HTTPS endpoint URL (e.g. 'https://api.example.com/webhook')",
    },
} as const satisfies Record<string, FieldSchema>;

export class StreamsBuildTool extends StreamsToolBase {
    static toolName = "atlas-streams-build";
    static operationType: OperationType = "create";

    public description =
        "Create Atlas Stream Processing resources. " +
        "Use this tool for 'set up a Kafka pipeline', 'create a workspace', 'add a connection', or 'deploy a processor'. " +
        "Use resource='workspace' to create a new workspace (specify cloud provider, region, and tier). " +
        "Use resource='connection' to add a data source or sink to an existing workspace. " +
        "Use resource='processor' to deploy a stream processor with a pipeline. " +
        "Use resource='privatelink' to set up private networking. " +
        "Typical workflow: create workspace → add connections → deploy processor.";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe(
            "Atlas project ID. Use atlas-list-projects to find project IDs if not available."
        ),
        resource: BuildResource.describe(
            "What to create. Start with 'workspace', then 'connection', then 'processor'. " +
                "Use 'privatelink' only if connections need private networking."
        ),
        workspaceName: StreamsArgs.workspaceName()
            .optional()
            .describe(
                "Workspace name. Required for workspace, connection, and processor resources. " +
                    "Not required for privatelink (which is project-level). " +
                    "For 'workspace': the name to create. For others: the existing workspace to add to. " +
                    "Use `atlas-streams-discover` with action 'list-workspaces' to see existing workspaces."
            ),

        // Workspace fields
        cloudProvider: CloudProvider.optional().describe("Cloud provider. Required when resource='workspace'."),
        region: AtlasArgs.region()
            .optional()
            .describe(
                "Cloud region. Required when resource='workspace'. " +
                    "Use Atlas region names: AWS examples: 'VIRGINIA_USA', 'OREGON_USA', 'DUBLIN_IRL'. " +
                    "Azure examples: 'eastus2', 'westeurope'. GCP examples: 'US_CENTRAL1', 'EUROPE_WEST1'."
            ),
        tier: z
            .enum(["SP2", "SP5", "SP10", "SP30", "SP50"])
            .optional()
            .describe("Processing tier. Default: SP10. Only for resource='workspace'."),
        includeSampleData: z
            .boolean()
            .optional()
            .describe(
                "Include the sample_stream_solar connection for testing. Default: true. Only for resource='workspace'."
            ),

        // Connection fields
        connectionName: StreamsArgs.connectionName()
            .optional()
            .describe("Connection name. Required when resource='connection'."),
        connectionType: ConnectionType.optional().describe(
            "Connection type. Required when resource='connection'. " +
                "Kafka: needs bootstrapServers, authentication, security config. " +
                "Cluster: needs clusterName and dbRoleToExecute. " +
                "S3: needs aws.roleArn (must be registered via Atlas Cloud Provider Access). " +
                "Https: needs url. " +
                "AWSKinesisDataStreams: needs aws.roleArn (must be registered via Atlas Cloud Provider Access). " +
                "AWSLambda: needs aws.roleArn (must be registered via Atlas Cloud Provider Access). " +
                "SchemaRegistry: needs provider, schemaRegistryUrls, and authentication config. " +
                "Sample: provides sample data for testing (no config needed)."
        ),
        connectionConfig: ConnectionConfig.optional().describe(
            "Type-specific connection configuration. Only for resource='connection'. " +
                "Omit entirely for connectionType='Sample' (no config needed). " +
                "You may pass a partial config — the tool uses elicitation to collect missing required fields directly from the user."
        ),

        // Processor fields
        processorName: StreamsArgs.processorName()
            .optional()
            .describe("Processor name. Required when resource='processor'."),
        pipeline: z
            .array(z.record(z.string(), z.unknown()))
            .optional()
            .describe(
                "Pipeline stages for the stream processor. Required when resource='processor'. " +
                    "Must start with a $source stage and end with a terminal stage ($merge, $emit, $https, or $externalFunction). " +
                    "Use $merge to write to Atlas cluster collections: {$merge: {into: {connectionName, db, coll}}}. " +
                    "Use $emit to write to Kafka or Kinesis sinks: {$emit: {connectionName, topic}}. $emit only works with Kafka/Kinesis connections — do NOT use $emit with Https connections. " +
                    "Use $https to POST data to an Https connection: {$https: {connectionName}}. " +
                    "Use $externalFunction for Lambda: {$externalFunction: {connectionName, functionName, execution: 'async', as: 'result'}}. Lambda does NOT use $emit — use $externalFunction with execution='async' as a terminal stage or execution='sync' for mid-pipeline enrichment. " +
                    "By default $https.onError is 'dlq', which requires a DLQ (see dlq parameter). Set {$https: {connectionName, onError: 'ignore'}} to skip DLQ. " +
                    "For Kafka $emit with Schema Registry: {$emit: {connectionName, topic, schemaRegistry: {connectionName: '<sr-connection>', valueSchema: {type: 'avro', schema: {<avro-schema>}, options: {subjectNameStrategy: 'TopicNameStrategy', autoRegisterSchemas: true}}}}}. " +
                    "Note: valueSchema.type must be lowercase 'avro'. valueSchema.schema (Avro schema definition) is always required even with autoRegisterSchemas. " +
                    "Kafka/Kinesis $source must include a 'topic'/'stream' field. " +
                    "$$NOW, $$ROOT, and $$CURRENT are not available in streaming context. " +
                    "Connections referenced in $source/$merge/$emit/$https must already exist in the workspace."
            ),
        dlq: z
            .object({
                connectionName: z.string().describe("Atlas connection name for DLQ output"),
                db: z.string().describe("Database name for DLQ collection"),
                coll: z.string().describe("Collection name for DLQ documents"),
            })
            .optional()
            .describe(
                "Dead letter queue configuration. Only for resource='processor'. " +
                    "Only include when the user explicitly requests a DLQ, or when the pipeline uses $https with default onError='dlq'. " +
                    "The DLQ connection must already exist in the workspace."
            ),
        autoStart: z
            .boolean()
            .optional()
            .describe(
                "Start the processor immediately after creation. Default: false. Only for resource='processor'. " +
                    "Omit unless the user explicitly asks to start the processor right away."
            ),

        // PrivateLink fields
        privateLinkConfig: PrivateLinkConfig.optional().describe(
            "PrivateLink configuration including provider and provider-specific fields. Required when resource='privatelink'."
        ),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        switch (args.resource) {
            case "workspace":
                return this.createWorkspace(args);
            case "connection":
                return this.createConnection(args);
            case "processor":
                return this.createProcessor(args);
            case "privatelink":
                return this.createPrivateLink(args);
            default:
                return {
                    content: [{ type: "text", text: `Unknown resource type: ${args.resource as string}` }],
                    isError: true,
                };
        }
    }

    private requireWorkspaceName(args: ToolArgs<typeof this.argsShape>): string {
        if (!args.workspaceName) {
            throw new Error("workspaceName is required for this resource type.");
        }
        return args.workspaceName;
    }

    private async createWorkspace(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspaceName = this.requireWorkspaceName(args);
        if (!args.cloudProvider) {
            throw new Error("cloudProvider is required when creating a workspace. Choose from: AWS, AZURE, GCP.");
        }
        if (!args.region) {
            throw new Error(
                "region is required when creating a workspace (e.g. 'VIRGINIA_USA', 'eastus2', 'US_CENTRAL1')."
            );
        }

        const body = {
            name: workspaceName,
            dataProcessRegion: {
                cloudProvider: args.cloudProvider,
                region: args.region,
            },
            streamConfig: {
                tier: args.tier ?? "SP10",
            },
        };

        const useSample = args.includeSampleData !== false;
        if (useSample) {
            await this.apiClient.withStreamSampleConnections({
                params: { path: { groupId: args.projectId } },
                // Atlas OpenAPI types cloudProvider/region as literal enums; we validate at the
                // input schema layer so the cast is safe here.
                body: body as never,
            });
        } else {
            await this.apiClient.createStreamWorkspace({
                params: { path: { groupId: args.projectId } },
                body: body as never,
            });
        }

        const sampleNote = useSample ? " Includes sample_stream_solar connection for testing." : "";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Workspace '${workspaceName}' created in ${args.cloudProvider}/${args.region} (${args.tier ?? "SP10"}).${sampleNote}\n\n` +
                        `Next: Add data source/sink connections with \`atlas-streams-build\` resource='connection', ` +
                        `then deploy a processor with resource='processor'.`,
                },
            ],
        };
    }

    private async createConnection(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspaceName = this.requireWorkspaceName(args);
        if (!args.connectionName) {
            throw new Error("connectionName is required when adding a connection.");
        }
        if (!args.connectionType) {
            throw new Error(
                "connectionType is required. Choose from: Kafka, Cluster, S3, Https, AWSKinesisDataStreams, AWSLambda, SchemaRegistry, Sample."
            );
        }

        const config = { ...ConnectionConfig.parse(args.connectionConfig ?? {}) };

        // Alias normalization must happen BEFORE strict type validation. Otherwise the
        // SchemaRegistry "url → schemaRegistryUrls" kind of aliases would get rejected
        // as cross-type fields before they're collapsed into canonical ones.
        if (args.connectionType === "SchemaRegistry") {
            StreamsBuildTool.normalizeSchemaRegistryAliases(config);
        }

        const typeValidationError = rejectInvalidConnectionConfig(config, args.connectionType, "create");
        if (typeValidationError) {
            return typeValidationError;
        }

        const missingInfo = await this.normalizeAndValidateConnectionConfig(config, args.connectionType);
        if (missingInfo) {
            return missingInfo;
        }

        const body: Record<string, unknown> = {
            ...config,
            name: args.connectionName,
            type: args.connectionType,
        };

        await this.apiClient.createStreamConnection({
            params: { path: { groupId: args.projectId, tenantName: workspaceName } },
            // StreamsConnection body is a discriminated union in the OpenAPI types; the
            // per-type schemas (connectionConfigs.ts) plus the alias normalization and
            // normalizeAndValidateConnectionConfig step validate the payload shape before
            // we reach this call.
            body: body as never,
        });

        const privateLinkWarning =
            config?.networking?.access?.type === "PRIVATE_LINK"
                ? `\n\nNote: This connection uses PrivateLink and will start in PENDING state. It may take a few minutes to provision. Use \`atlas-streams-discover\` with action 'inspect-connection' to check when it becomes READY.`
                : "";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Connection '${args.connectionName}' (${args.connectionType}) added to workspace '${workspaceName}'.${privateLinkWarning}\n\n` +
                        `Next: Add more connections or deploy a processor with \`atlas-streams-build\` resource='processor'. ` +
                        `Reference this connection as '${args.connectionName}' in your processor pipeline's $source, $merge, or $emit stages.`,
                },
            ],
        };
    }

    /**
     * Validates and normalizes connectionConfig for the given type. Applies sensible
     * defaults, fixes common format mismatches, and uses elicitation to collect
     * missing sensitive fields (like passwords) directly from the user when supported.
     *
     * @returns null if config is valid and ready to send, or a CallToolResult
     *          describing what information is still needed.
     */
    private async normalizeAndValidateConnectionConfig(
        config: Record<string, unknown>,
        connectionType: string
    ): Promise<CallToolResult | null> {
        switch (connectionType) {
            case "Kafka":
                return this.validateKafkaConfig(config);
            case "Cluster":
                return this.validateClusterConfig(config);
            case "S3":
            case "AWSKinesisDataStreams":
            case "AWSLambda":
                return this.validateAwsConfig(config, connectionType);
            case "SchemaRegistry":
                return this.validateSchemaRegistryConfig(config);
            case "Https":
                return this.validateHttpsConfig(config);
            default:
                return null;
        }
    }

    private async validateKafkaConfig(config: Record<string, unknown>): Promise<CallToolResult | null> {
        const auth = config.authentication as Record<string, unknown> | undefined;
        const security = config.security as Record<string, unknown> | undefined;

        const missingFields = StreamsBuildTool.collectMissingFields([
            { key: "bootstrapServers", present: !!config.bootstrapServers, schema: KAFKA_FIELDS.bootstrapServers },
            { key: "mechanism", present: !!auth?.mechanism, schema: KAFKA_FIELDS.mechanism },
            { key: "username", present: !!auth?.username, schema: KAFKA_FIELDS.username },
            { key: "password", present: !!auth?.password, schema: KAFKA_FIELDS.password },
            { key: "protocol", present: !!security?.protocol, schema: KAFKA_FIELDS.protocol },
        ]);

        if (missingFields.length === 0) {
            return null;
        }

        return this.elicitOrReportMissing("Kafka", config, missingFields, (fields, cfg) => {
            if (fields.bootstrapServers) cfg.bootstrapServers = fields.bootstrapServers;
            if (!cfg.authentication) cfg.authentication = {};
            const authObj = cfg.authentication as Record<string, unknown>;
            if (fields.mechanism) authObj.mechanism = fields.mechanism;
            if (fields.username) authObj.username = fields.username;
            if (fields.password) authObj.password = fields.password;
            if (!cfg.security) cfg.security = {};
            const secObj = cfg.security as Record<string, unknown>;
            if (fields.protocol) secObj.protocol = fields.protocol;
        });
    }

    private async validateClusterConfig(config: Record<string, unknown>): Promise<CallToolResult | null> {
        const missingFields = StreamsBuildTool.collectMissingFields([
            { key: "clusterName", present: !!config.clusterName, schema: CLUSTER_FIELDS.clusterName },
        ]);

        // dbRoleToExecute is a config choice, not user-specific data — safe to default
        if (!config.dbRoleToExecute) {
            config.dbRoleToExecute = { role: "readWriteAnyDatabase", type: "BUILT_IN" };
        }

        if (missingFields.length === 0) {
            return null;
        }

        return this.elicitOrReportMissing("Cluster", config, missingFields, (fields, cfg) => {
            if (fields.clusterName) cfg.clusterName = fields.clusterName;
        });
    }

    private async validateAwsConfig(
        config: Record<string, unknown>,
        connectionType: string
    ): Promise<CallToolResult | null> {
        const aws = config.aws as Record<string, unknown> | undefined;

        const missingFields = StreamsBuildTool.collectMissingFields([
            { key: "roleArn", present: !!aws?.roleArn, schema: AWS_FIELDS.roleArn },
        ]);

        if (missingFields.length === 0) {
            return null;
        }

        return this.elicitOrReportMissing(
            connectionType,
            config,
            missingFields,
            (fields, cfg) => {
                if (fields.roleArn) {
                    if (!cfg.aws) cfg.aws = {};
                    (cfg.aws as Record<string, unknown>).roleArn = fields.roleArn;
                }
            },
            `Note: The IAM role ARN must first be registered in the Atlas project via Cloud Provider Access.\n` +
                `To find available ARNs: Atlas UI → Project Settings → Cloud Provider Access.\n` +
                `To register a new one: Atlas UI → Project Settings → Cloud Provider Access → Authorize an AWS IAM role.`
        );
    }

    private async validateSchemaRegistryConfig(config: Record<string, unknown>): Promise<CallToolResult | null> {
        // Alias normalization now runs earlier in createConnection (see
        // `normalizeSchemaRegistryAliases`) so strict type validation doesn't reject aliases.

        // Default provider to CONFLUENT — currently the only supported value
        if (!config.provider) {
            config.provider = "CONFLUENT";
        }

        // Default auth type to USER_INFO when credentials are provided
        if (!config.schemaRegistryAuthentication) {
            config.schemaRegistryAuthentication = {};
        }
        const auth = config.schemaRegistryAuthentication as Record<string, unknown>;
        if (!auth.type) {
            auth.type = "USER_INFO";
        }

        const requiresCredentials = auth.type !== "SASL_INHERIT";
        const missingFields = StreamsBuildTool.collectMissingFields([
            {
                key: "schemaRegistryUrl",
                present: Array.isArray(config.schemaRegistryUrls) && config.schemaRegistryUrls.length > 0,
                schema: SCHEMA_REGISTRY_FIELDS.schemaRegistryUrl,
            },
            {
                key: "username",
                present: !requiresCredentials || !!auth.username,
                schema: SCHEMA_REGISTRY_FIELDS.username,
            },
            {
                key: "password",
                present: !requiresCredentials || !!auth.password,
                schema: SCHEMA_REGISTRY_FIELDS.password,
            },
        ]);

        if (missingFields.length === 0) {
            return null;
        }

        return this.elicitOrReportMissing("SchemaRegistry", config, missingFields, (fields, cfg) => {
            if (fields.schemaRegistryUrl) {
                cfg.schemaRegistryUrls = [fields.schemaRegistryUrl];
            }
            const authObj = cfg.schemaRegistryAuthentication as Record<string, unknown>;
            if (fields.username) authObj.username = fields.username;
            if (fields.password) authObj.password = fields.password;
        });
    }

    private async validateHttpsConfig(config: Record<string, unknown>): Promise<CallToolResult | null> {
        const missingFields = StreamsBuildTool.collectMissingFields([
            { key: "url", present: !!config.url, schema: HTTPS_FIELDS.url },
        ]);

        if (missingFields.length === 0) {
            return null;
        }

        return this.elicitOrReportMissing("Https", config, missingFields, (fields, cfg) => {
            if (fields.url) cfg.url = fields.url;
        });
    }

    // --- Shared elicitation helpers ---

    /**
     * Attempts to collect all missing required fields via elicitation. If the
     * client supports it, shows a single form with every missing field. If not
     * (or the user declines), returns a structured response listing what's needed.
     */
    private async elicitOrReportMissing(
        connectionType: string,
        config: Record<string, unknown>,
        missingFields: MissingField[],
        applyFields: (fields: Record<string, string>, config: Record<string, unknown>) => void,
        additionalNote?: string
    ): Promise<CallToolResult | null> {
        const schema = StreamsBuildTool.buildElicitationSchema(connectionType, missingFields);

        const elicited = await this.elicitation.requestInput(
            `The following information is required to create the ${connectionType} connection.`,
            schema
        );

        if (elicited.accepted) {
            applyFields(elicited.fields, config);

            // Re-check: did the user leave any fields empty in the form?
            const stillMissing = missingFields.filter((f) => !elicited.fields[f.key]);
            if (stillMissing.length > 0) {
                return StreamsBuildTool.missingFieldsResponse(connectionType, stillMissing, additionalNote);
            }
            return null;
        }

        return StreamsBuildTool.missingFieldsResponse(connectionType, missingFields, additionalNote);
    }

    /**
     * Collapses SchemaRegistry alias field names (url / urls / endpoint / schemaRegistryUrl
     * and flat username/password/authentication) into the canonical fields expected by the
     * Atlas API and by `SchemaRegistryConnectionConfig`. Runs before strict type validation
     * so alias inputs survive the cross-type check.
     */
    private static normalizeSchemaRegistryAliases(config: Record<string, unknown>): void {
        if (!config.schemaRegistryUrls) {
            const alt = config.url || config.urls || config.endpoint || config.schemaRegistryUrl;
            if (alt) {
                config.schemaRegistryUrls = Array.isArray(alt) ? alt : [alt];
                delete config.url;
                delete config.urls;
                delete config.endpoint;
                delete config.schemaRegistryUrl;
            }
        }

        if (!config.schemaRegistryAuthentication && (config.username || config.authentication)) {
            const authSource = (config.authentication as Record<string, unknown>) || {};
            config.schemaRegistryAuthentication = {
                type: "USER_INFO",
                username: config.username || authSource.username,
                password: config.password || authSource.password,
            };
            delete config.username;
            delete config.password;
            delete config.authentication;
        }
    }

    private static collectMissingFields(
        checks: { key: string; present: boolean; schema: FieldSchema }[]
    ): MissingField[] {
        return checks.filter((c) => !c.present).map((c) => ({ key: c.key, ...c.schema }));
    }

    private static buildElicitationSchema(
        _connectionType: string,
        missingFields: MissingField[]
    ): ElicitRequestFormParams["requestedSchema"] {
        const properties: Record<string, { type: "string"; title: string; description: string }> = {};
        for (const field of missingFields) {
            properties[field.key] = {
                type: "string" as const,
                title: field.title,
                description: field.description,
            };
        }
        return {
            type: "object" as const,
            properties,
            required: missingFields.map((f) => f.key),
        };
    }

    private static missingFieldsResponse(
        connectionType: string,
        missingFields: MissingField[],
        additionalNote?: string
    ): CallToolResult {
        const list = missingFields.map((f) => `  - ${f.title}: ${f.description}`).join("\n");
        const note = additionalNote ? `\n\n${additionalNote}` : "";
        return {
            content: [
                {
                    type: "text",
                    text:
                        `Cannot create ${connectionType} connection — the following required information is missing:\n${list}\n\n` +
                        `Please ask the user to provide these values and retry.${note}`,
                },
            ],
            isError: true,
        };
    }

    private static validatePipelineStructure(pipeline: Record<string, unknown>[]): CallToolResult | null {
        const TERMINAL_STAGES = new Set(["$merge", "$emit", "$https", "$externalFunction"]);

        const firstStage = pipeline[0];
        const firstStageKey = firstStage ? Object.keys(firstStage)[0] : undefined;
        if (firstStageKey !== "$source") {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Invalid pipeline: first stage must be \`$source\`, but found \`${firstStageKey}\`.\n\n` +
                            `A streaming pipeline must start with $source to define the input data stream. ` +
                            `Example: {$source: {connectionName: "myConnection", topic: "myTopic"}}`,
                    },
                ],
                isError: true,
            };
        }

        const lastStage = pipeline[pipeline.length - 1];
        const lastStageKey = lastStage ? Object.keys(lastStage)[0] : undefined;
        if (!lastStageKey || !TERMINAL_STAGES.has(lastStageKey)) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Invalid pipeline: last stage must be a terminal stage (\`$merge\`, \`$emit\`, \`$https\`, or \`$externalFunction\`), but found \`${lastStageKey}\`.\n\n` +
                            `Use $merge to write to Atlas clusters: {$merge: {into: {connectionName, db, coll}}}.\n` +
                            `Use $emit to write to Kafka/Kinesis/external sinks: {$emit: {connectionName, topic}}.`,
                    },
                ],
                isError: true,
            };
        }

        const pipelineStr = JSON.stringify(pipeline);
        const unsupportedVars = ["$$NOW", "$$ROOT", "$$CURRENT"].filter((v) => pipelineStr.includes(v));
        if (unsupportedVars.length > 0) {
            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Warning: pipeline contains ${unsupportedVars.join(", ")} which ${unsupportedVars.length === 1 ? "is" : "are"} not available in streaming context.\n\n` +
                            `These system variables are not supported in Atlas Stream Processing pipelines. ` +
                            `Remove or replace them before deploying.`,
                    },
                ],
                isError: true,
            };
        }

        return null;
    }

    private async validatePipelineConnections(
        projectId: string,
        workspaceName: string,
        pipeline: Record<string, unknown>[],
        dlq?: { connectionName: string; db: string; coll: string }
    ): Promise<CallToolResult | null> {
        const referencedNames = StreamsToolBase.extractConnectionNames(pipeline);
        if (dlq?.connectionName) referencedNames.add(dlq.connectionName);
        if (referencedNames.size === 0) return null;

        let availableNames: Set<string>;
        try {
            const data = await this.apiClient.listStreamConnections({
                params: {
                    path: { groupId: projectId, tenantName: workspaceName },
                    query: { itemsPerPage: 100, pageNum: 1 },
                },
            });
            availableNames = new Set((data?.results ?? []).map((c) => String((c as Record<string, unknown>).name)));
        } catch {
            return null; // Soft check — skip if we can't list connections
        }

        const missingNames = [...referencedNames].filter((n) => !availableNames.has(n));
        if (missingNames.length === 0) return null;

        const availableList =
            availableNames.size > 0
                ? [...availableNames].map((n) => `  - ${n}`).join("\n")
                : "  (no connections found)";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Cannot create processor — the pipeline references connection(s) that do not exist in workspace '${workspaceName}':\n` +
                        `  Missing: ${missingNames.join(", ")}\n\n` +
                        `Available connections:\n${availableList}\n\n` +
                        `Add the missing connection(s) first with \`atlas-streams-build\` resource='connection', then retry.`,
                },
            ],
            isError: true,
        };
    }

    private async createProcessor(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const workspaceName = this.requireWorkspaceName(args);
        if (!args.processorName) {
            throw new Error("processorName is required when deploying a processor.");
        }
        if (!args.pipeline || args.pipeline.length === 0) {
            throw new Error(
                "pipeline is required. Provide an array of aggregation stages starting with $source and ending with a terminal stage ($merge, $emit, $https, or $externalFunction)."
            );
        }

        const structureError = StreamsBuildTool.validatePipelineStructure(args.pipeline);
        if (structureError) return structureError;

        const connectionError = await this.validatePipelineConnections(
            args.projectId,
            workspaceName,
            args.pipeline,
            args.dlq
        );
        if (connectionError) return connectionError;

        const body = {
            name: args.processorName,
            pipeline: args.pipeline,
            options: args.dlq ? { dlq: args.dlq } : undefined,
        };

        await this.apiClient.createStreamProcessor({
            params: { path: { groupId: args.projectId, tenantName: workspaceName } },
            // Atlas OpenAPI `pipeline` is typed as a tightly indexed object union our generic
            // pipeline-stages array can't satisfy. validatePipelineStructure checks the shape.
            body: body as never,
        });

        let startMessage = "Processor created in CREATED state.";
        if (args.autoStart) {
            await this.apiClient.startStreamProcessor({
                params: {
                    path: {
                        groupId: args.projectId,
                        tenantName: workspaceName,
                        processorName: args.processorName,
                    },
                },
            });
            startMessage = "Processor created and started.";
        }

        const dlqNote = args.dlq
            ? ` DLQ configured: ${args.dlq.db}.${args.dlq.coll} via '${args.dlq.connectionName}'.`
            : " Consider adding a DLQ for production use.";

        const billingNote = args.autoStart
            ? `\n\nNote: Billing for stream processing usage is now active for this processor. ` +
              `Use \`atlas-streams-manage\` with action 'stop-processor' to stop billing.`
            : "";

        return {
            content: [
                {
                    type: "text",
                    text:
                        `${startMessage} Processor '${args.processorName}' deployed in workspace '${workspaceName}'.${dlqNote}\n\n` +
                        (args.autoStart
                            ? `Use \`atlas-streams-discover\` with action 'diagnose-processor' to monitor health.`
                            : `Use \`atlas-streams-manage\` with action 'start-processor' to begin processing.`) +
                        billingNote,
                },
            ],
        };
    }

    private async createPrivateLink(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        if (!args.privateLinkConfig) {
            throw new Error(
                "privateLinkConfig is required. Provide provider and vendor-specific fields:\n" +
                    "  AWS CONFLUENT: {provider, vendor:'CONFLUENT', region, serviceEndpointId, dnsDomain, dnsSubDomain: string[] of full FQDNs ([] for serverless)}\n" +
                    "  AWS MSK: {provider, vendor:'MSK', arn}\n" +
                    "  AWS S3: {provider, vendor:'S3', region, serviceEndpointId:'com.amazonaws.<region>.s3'}\n" +
                    "  AWS KINESIS: {provider, vendor:'KINESIS', region, serviceEndpointId}\n" +
                    "  AZURE EVENTHUB: {provider, vendor:'EVENTHUB', region, dnsDomain, serviceEndpointId (full Azure Resource ID)}\n" +
                    "  AZURE CONFLUENT: {provider, vendor:'CONFLUENT', region, dnsDomain, azureResourceIds}\n" +
                    "  GCP CONFLUENT: {provider, vendor:'CONFLUENT', region, dnsDomain, gcpServiceAttachmentUris}"
            );
        }
        if (!args.privateLinkConfig.provider) {
            throw new Error("privateLinkConfig.provider is required. Choose from: AWS, AZURE, GCP.");
        }

        const body: Record<string, unknown> = {
            ...args.privateLinkConfig,
        };

        await this.apiClient.createPrivateLinkConnection({
            params: { path: { groupId: args.projectId } },
            // PrivateLink body is a provider-discriminated union in OpenAPI; the
            // PrivateLinkConnectionConfig schema validates provider at the input layer.
            body: body as never,
        });

        return {
            content: [
                {
                    type: "text",
                    text:
                        `PrivateLink connection created for ${args.privateLinkConfig.provider}. ` +
                        `It may take a few minutes to become active. ` +
                        `Use \`atlas-streams-discover\` with action 'get-networking' to check status.\n\n` +
                        `Once active, create connections with networking.access.type='PRIVATE_LINK' to use it.`,
                },
            ],
        };
    }
}
