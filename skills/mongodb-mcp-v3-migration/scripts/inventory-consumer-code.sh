#!/usr/bin/env bash
# inventory-consumer-code.sh [dir]
#
# Finds consumer-project files that import "mongodb-mcp-server" (v1/v2 library usage)
# and classifies every imported symbol against the v3 scoped packages
# (@mongodb-js/mcp-*). Run in the consumer's repository root. Works on bash 3.2+
# (macOS default) — no bash-specific features.
#
# Output per file:
#   <file>
#     <import line>
#       <symbol> -> <v3 package>   (or "unrecognized — manual review")
#
# Read-only; exits 0 even when nothing is found.

dir="${1:-.}"

pkg_of() {
    # echo the v3 package for a given imported symbol.
    case "$1" in
        # mcp-cli (CLI / server / session / config)
        Server|ServerOptions|Session|SessionOptions|CliServer|CliServerOptions|CliSession|CliSessionOptions) echo "@mongodb-js/mcp-cli" ;;
        runMcpCli|Resources|startServer) echo "@mongodb-js/mcp-cli" ;;
        createServicesFromConfig|createLoggerFromConfig|createApiClientFromConfig|createMonitoringServerFromConfig|createConnectionManagerFromConfig) echo "@mongodb-js/mcp-cli" ;;
        parseUserConfig|applyConfigOverrides|configRegistry|getConfigMeta|nameToConfigKey) echo "@mongodb-js/mcp-cli" ;;
        UserConfig|UserConfigSchema) echo "@mongodb-js/mcp-cli" ;;
        HelpHandler|VersionHandler|DryRunHandler|Elicitation|McpSession|SessionCloseReason) echo "@mongodb-js/mcp-cli" ;;

        # mcp-core (runners, session store, tool base, helpers)
        StdioRunner|SessionStore|Keychain|NoopTelemetry|InMemoryTransport|NoopLogger) echo "@mongodb-js/mcp-core" ;;
        ToolBase|ToolClass|ToolArgs|OperationType|ToolCategory|packageInfo) echo "@mongodb-js/mcp-core" ;;

        # mcp-http-runners
        StreamableHttpRunner|MCPHttpServer|MonitoringServer) echo "@mongodb-js/mcp-http-runners" ;;
        StreamableHttpRunnerOptions|MCPHttpServerOptions|MonitoringServerOptions) echo "@mongodb-js/mcp-http-runners" ;;

        # mcp-types
        TransportRequestContext|ITransportRunner|ISession|ServerMetadata|IMetrics|DefaultMetricDefinitions|TransportType) echo "@mongodb-js/mcp-types" ;;

        # mcp-tools-mongodb
        MongoDBToolBase|MongoDBTools|MCPConnectionManager|ConnectionManager|ErrorCodes|MongoDBError|ExportsManager) echo "@mongodb-js/mcp-tools-mongodb" ;;

        # mcp-tools-atlas / -atlas-local / -assistant
        AtlasTools|AtlasToolBase) echo "@mongodb-js/mcp-tools-atlas" ;;
        AtlasLocalTools|createAtlasLocalClient) echo "@mongodb-js/mcp-tools-atlas-local" ;;
        AssistantTools) echo "@mongodb-js/mcp-tools-assistant" ;;

        # mcp-atlas-api-client
        ApiClient|ClientCredentialsAuthProvider) echo "@mongodb-js/mcp-atlas-api-client" ;;

        # mcp-atlas-telemetry
        AtlasTelemetry|TelemetryBaseEvent|TelemetryCommonProperties|TelemetryConfig|TelemetryEvents|EventCache) echo "@mongodb-js/mcp-atlas-telemetry" ;;

        # mcp-logging
        ConsoleLogger|DiskLogger|McpLogger|LoggerBase|CompositeLogger) echo "@mongodb-js/mcp-logging" ;;

        # mcp-metrics
        createDefaultMetrics|PrometheusMetrics) echo "@mongodb-js/mcp-metrics" ;;

        # mcp-ui
        UIRegistry) echo "@mongodb-js/mcp-ui" ;;

        # Removed from the v1 public API — replaced per the migration table
        Telemetry) echo "REPLACED by AtlasTelemetry -> @mongodb-js/mcp-atlas-telemetry" ;;
        BaseEvent) echo "REPLACED by TelemetryBaseEvent -> @mongodb-js/mcp-atlas-telemetry" ;;
        CommonProperties) echo "REPLACED by TelemetryCommonProperties -> @mongodb-js/mcp-atlas-telemetry" ;;
        NullLogger) echo "REPLACED by NoopLogger -> @mongodb-js/mcp-core" ;;
        RequestContext) echo "REPLACED by TransportRequestContext -> @mongodb-js/mcp-types" ;;
        TransportRunnerBase) echo "REPLACED by ITransportRunner -> @mongodb-js/mcp-types" ;;
        Metrics) echo "REPLACED by IMetrics -> @mongodb-js/mcp-types" ;;
        DefaultMetrics) echo "REPLACED by DefaultMetricDefinitions -> @mongodb-js/mcp-types" ;;
        MCPHttpServerConstructorArgs) echo "REPLACED by MCPHttpServerOptions -> @mongodb-js/mcp-http-runners" ;;
        MonitoringServerConstructorArgs) echo "REPLACED by MonitoringServerOptions -> @mongodb-js/mcp-http-runners" ;;
        StreamableHttpTransportRunnerConfig) echo "REPLACED by StreamableHttpRunnerOptions -> @mongodb-js/mcp-http-runners" ;;
        createDefaultMcpHttpServer) echo "REPLACED by new MCPHttpServer(...) -> @mongodb-js/mcp-http-runners" ;;
        createDefaultMonitoringServer) echo "REPLACED by new MonitoringServer(...) -> @mongodb-js/mcp-http-runners" ;;
        createDefaultSessionStore) echo "REPLACED by new SessionStore(...) -> @mongodb-js/mcp-core" ;;
        createMCPConnectionManager) echo "REPLACED by createConnectionManagerFromConfig -> @mongodb-js/mcp-cli" ;;
        defaultCreateApiClient) echo "REPLACED by createApiClientFromConfig -> @mongodb-js/mcp-cli" ;;
        defaultCreateAtlasLocalClient) echo "REPLACED by createAtlasLocalClient -> @mongodb-js/mcp-tools-atlas-local" ;;
        defaultCreateConnectionManager) echo "REPLACED by createConnectionManagerFromConfig -> @mongodb-js/mcp-cli" ;;
        createServicesFromUserConfig) echo "REPLACED by createServicesFromConfig -> @mongodb-js/mcp-cli" ;;
        parseArgsWithCliOptions) echo "REPLACED by parseUserConfig -> @mongodb-js/mcp-cli" ;;
        AllTools) echo "REPLACED by MongoDBTools/AtlasTools/AtlasLocalTools/AssistantTools bundles" ;;
        UIRegistryOptions) echo "removed type (options now inline)" ;;

        # Unmapped tool classes — point at the bundle, need per-symbol confirmation
        *Tool) echo "@mongodb-js/mcp-tools-* (find the exact bundle)" ;;
        *) echo "unrecognized — manual review" ;;
    esac
}

matches=$(grep -rInE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' \
    -e "['\"]mongodb-mcp-server(/[^'\"]*)?['\"]" \
    "$dir" 2>/dev/null | grep -vE 'node_modules|/dist/|/build/|/coverage/' || true)

if [ -z "$matches" ]; then
    echo "No consumer files import 'mongodb-mcp-server' under '$dir'."
    exit 0
fi

current_file=""
while IFS=: read -r file lineno line; do
    if [ "$file" != "$current_file" ]; then
        current_file="$file"
        echo
        echo "$file"
    fi
    printf '  L%s: %s\n' "$lineno" "$line"
    # Extract imported identifiers from: import { a, b } from "mongodb-mcp-server"
    # (also 'import a from ...' and verbatim namespace import * as x).
    idents=$(printf '%s' "$line" | sed -nE \
        "s/.*import[[:space:]]*\{([^}]*)\}[[:space:]]*from[[:space:]]*['\"]mongodb-mcp-server.*/\1/p; \
         s/.*import[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]+from[[:space:]]*['\"]mongodb-mcp-server.*/\1/p; \
         s/.*import[[:space:]]*\*[[:space:]]*as[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\1 (namespace)/p")
    if [ -n "$idents" ]; then
        printf '%s' "$idents" | tr ',' '\n' | sed -E 's/^[[:space:]]*//; s/[[:space:]]+as[[:space:]]+[A-Za-z_][A-Za-z0-9_]*$//; s/^type[[:space:]]+//; s/[[:space:]]*$//' | grep -vE '^$' | while IFS= read -r sym; do
            printf '    %s -> %s\n' "$sym" "$(pkg_of "$sym")"
        done
    else
        printf '    (require()/dynamic access — inspect manually)\n'
    fi
done <<< "$matches"

echo
echo "Summary: $(printf '%s\n' "$matches" | awk -F: '{print $1}' | sort -u | wc -l | tr -d ' ') file(s) reference mongodb-mcp-server."
