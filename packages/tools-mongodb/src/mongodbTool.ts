import { z } from "zod";
import type { ToolArgs, ToolCategory } from "@mongodb-js/mcp-core";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCodes, MongoDBError } from "./common/errors.js";
import { LogId } from "@mongodb-js/mcp-logging";
import type { ConnectionMetadata, IToolConfig, IToolSession } from "@mongodb-js/mcp-types";

export interface IMongoDBConfig extends IToolConfig {
  connectionString?: string;
  indexCheck?: boolean;
  maxTimeMS?: number;
  maxDocumentsPerQuery?: number;
  maxBytesPerQuery?: number;
  httpHost?: string;
}

export interface IMongoDBSession extends IToolSession {
  isConnectedToMongoDB: boolean;
  connectedAtlasCluster?: { clusterName: string; projectId: string };
  serviceProvider: NodeDriverServiceProvider;
  connectToConfiguredConnection(): Promise<void>;
  connectToMongoDB(settings: { connectionString: string }): Promise<void>;
  connectionErrorHandler(
    error: MongoDBError,
    context: { availableTools: unknown[]; connectionState: unknown }
  ): Promise<{ errorHandled: boolean; result: CallToolResult }>;
  connectionManager: { currentConnectionState: unknown };
  exportsManager: { createJSONExport: (params: unknown) => Promise<unknown> };
  assertSearchSupported(): Promise<void>;
  isSearchSupported(): Promise<boolean>;
  on(event: "connect" | "disconnect", listener: () => void): void;
}

export const DBOperationArgs = {
  database: z.string().describe("Database name"),
};

export const CollOperationArgs = {
  ...DBOperationArgs,
  collection: z.string().describe("Collection name"),
};

export abstract class MongoDBToolBase extends ToolBase<IMongoDBConfig> {
  declare protected readonly session: IMongoDBSession;
  static category: ToolCategory = "mongodb";

  protected async ensureConnected(): Promise<NodeDriverServiceProvider> {
    if (!this.session.isConnectedToMongoDB) {
      if (this.session.connectedAtlasCluster) {
        throw new MongoDBError(
          ErrorCodes.NotConnectedToMongoDB,
          `Attempting to connect to Atlas cluster "${this.session.connectedAtlasCluster.clusterName}", try again in a few seconds.`
        );
      }

      if (this.config.connectionString) {
        try {
          await this.session.connectToConfiguredConnection();
        } catch (error) {
          this.session.logger.error({
            id: LogId.mongodbConnectFailure,
            context: "mongodbTool",
            message: `Failed to connect to MongoDB instance using the connection string from the config: ${error as string}`,
          });
          throw new MongoDBError(ErrorCodes.MisconfiguredConnectionString, "Not connected to MongoDB.");
        }
      }
    }

    if (!this.session.isConnectedToMongoDB) {
      throw new MongoDBError(ErrorCodes.NotConnectedToMongoDB, "Not connected to MongoDB");
    }

    return this.session.serviceProvider;
  }

  protected getOperationOptions(signal?: AbortSignal): { signal?: AbortSignal; maxTimeMS?: number } {
    return {
      ...(signal && { signal }),
      ...(this.config.maxTimeMS !== undefined && { maxTimeMS: this.config.maxTimeMS }),
    };
  }

  protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
    if (error instanceof MongoDBError) {
      switch (error.code) {
        case ErrorCodes.NotConnectedToMongoDB:
        case ErrorCodes.MisconfiguredConnectionString: {
          const connectionError = error as MongoDBError;
          const outcome = await this.session.connectionErrorHandler(connectionError, {
            availableTools: [],
            connectionState: this.session.connectionManager.currentConnectionState,
          });
          if (outcome.errorHandled) {
            return outcome.result;
          }

          return super.handleError(error, args);
        }
        case ErrorCodes.ForbiddenCollscan:
          return {
            content: [
              {
                type: "text",
                text: error.message,
              },
            ],
            isError: true,
          };
        case ErrorCodes.AtlasSearchNotSupported: {
          return {
            content: [
              {
                text: `The connected MongoDB deployment does not support vector search indexes. Either connect to a MongoDB Atlas cluster or use the Atlas CLI to create and manage a local Atlas deployment.`,
                type: "text",
              },
            ],
            isError: true,
          };
        }
      }
    }

    return super.handleError(error, args);
  }

  protected resolveTelemetryMetadata(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _args: ToolArgs<typeof this.argsShape>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { result }: { result: CallToolResult }
  ): ConnectionMetadata {
    return this.getConnectionInfoMetadata();
  }
}
