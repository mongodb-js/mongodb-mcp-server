import { describe, expect, it, vi } from "vitest";
import { CreateIndexTool } from "./createIndex.js";
import { ErrorCodes, MongoDBError } from "../../common/errors.js";

type Provider = {
    listCollections: ReturnType<typeof vi.fn>;
    runCommand: ReturnType<typeof vi.fn>;
};

type HandleError = (
    error: unknown,
    args: Record<string, unknown>
) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

const namespaceNotFound = (): Error =>
    Object.assign(new Error("Collection 'db.coll' does not exist."), { code: 26, codeName: "NamespaceNotFound" });

const searchArgs = { connectionId: "conn", database: "db", collection: "coll", definition: [{ type: "search" }] };

// handleError only touches `resolveConnection` (to look up the namespace),
// `server.logger` (diagnosis failures are logged at debug level), `server.keychain`
// (the shared error text is redacted) and `server.isToolCategoryAvailable` (used by
// the shared AtlasSearchNotSupported message). Building the full tool would need a
// session and a connection registry, so we create the instance without running the
// constructor and stub just those.
function setup(
    provider: Partial<Provider>,
    resolveConnection = vi.fn().mockResolvedValue(provider)
): { handleError: HandleError; loggerDebug: ReturnType<typeof vi.fn> } {
    const loggerDebug = vi.fn();
    const tool = Object.create(CreateIndexTool.prototype) as Record<string, unknown>;
    tool.name = "create-index";
    tool.resolveConnection = resolveConnection;
    tool.server = {
        keychain: { redact: (s: string): string => s },
        logger: { debug: loggerDebug },
        isToolCategoryAvailable: vi.fn().mockReturnValue(false),
    };
    return { handleError: (tool.handleError as HandleError).bind(tool), loggerDebug };
}

const viewInfo = { name: "coll", type: "view", options: { viewOn: "src", pipeline: [] } };

describe("CreateIndexTool handleError for search indexes on views", () => {
    it("explains the Atlas UI / Admin API requirement on 8.0 and names the source collection", async () => {
        const provider = {
            listCollections: vi.fn().mockResolvedValue([viewInfo]),
            runCommand: vi.fn().mockResolvedValue({ versionArray: [8, 0, 37, 0] }),
        };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.isError).toBe(true);
        const text = result.content[0]?.text ?? "";
        expect(text).toContain('"db.coll"');
        expect(text).toContain("is a view");
        expect(text).toContain("On Atlas, create the index through the Atlas UI or the Atlas Administration API");
        expect(text).toContain("8.1 or later");
        expect(text).toContain('source collection "src"');
        expect(text).toContain("by name");
        expect(text).toContain("MongoDB 8.0");
        expect(provider.listCollections).toHaveBeenCalledWith("db", { name: "coll" });
        expect(provider.runCommand).toHaveBeenCalledWith("admin", { buildInfo: 1 });
    });

    it("omits the source collection name when listCollections does not return viewOn", async () => {
        const provider = {
            listCollections: vi.fn().mockResolvedValue([{ name: "coll", type: "view" }]),
            runCommand: vi.fn().mockResolvedValue({ versionArray: [8, 0, 0, 0] }),
        };
        const { handleError } = setup(provider);

        const text = (await handleError(namespaceNotFound(), searchArgs)).content[0]?.text ?? "";

        expect(text).toContain("On Atlas, create the index through the Atlas UI");
        expect(text).toContain("the view's source collection");
        expect(text).not.toContain('source collection "');
    });

    it("says views are unsupported before 8.0", async () => {
        const provider = {
            listCollections: vi.fn().mockResolvedValue([viewInfo]),
            runCommand: vi.fn().mockResolvedValue({ versionArray: [7, 0, 12, 0] }),
        };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), {
            ...searchArgs,
            definition: [{ type: "vectorSearch" }],
        });

        const text = result.content[0]?.text ?? "";
        expect(result.isError).toBe(true);
        expect(text).toContain("require MongoDB 8.0 or later");
        expect(text).toContain("runs MongoDB 7.0");
        expect(text).not.toContain("Atlas UI");
    });

    it.each([
        ["8.1", [8, 1, 0, 0]],
        ["8.2", [8, 2, 0, 0]],
        ["9.0", [9, 0, 0, 0]],
    ])("keeps the original error on %s", async (_label, versionArray) => {
        const provider = {
            listCollections: vi.fn().mockResolvedValue([viewInfo]),
            runCommand: vi.fn().mockResolvedValue({ versionArray }),
        };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
    });

    it("keeps the original error when the namespace is a regular collection", async () => {
        const provider = {
            listCollections: vi.fn().mockResolvedValue([{ name: "coll", type: "collection" }]),
            runCommand: vi.fn(),
        };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
        expect(provider.runCommand).not.toHaveBeenCalled();
    });

    it("keeps the original error when the namespace does not exist at all", async () => {
        const provider = { listCollections: vi.fn().mockResolvedValue([]), runCommand: vi.fn() };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
        expect(provider.runCommand).not.toHaveBeenCalled();
    });

    it("does not look anything up for classic index definitions", async () => {
        const provider = { listCollections: vi.fn(), runCommand: vi.fn() };
        const { handleError } = setup(provider);

        const result = await handleError(namespaceNotFound(), { ...searchArgs, definition: [{ type: "classic" }] });

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
        expect(provider.listCollections).not.toHaveBeenCalled();
    });

    it("does not look anything up for errors other than NamespaceNotFound", async () => {
        const provider = { listCollections: vi.fn(), runCommand: vi.fn() };
        const { handleError } = setup(provider);

        const result = await handleError(new Error("boom"), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: boom");
        expect(provider.listCollections).not.toHaveBeenCalled();
    });

    it("keeps the original error when listCollections fails", async () => {
        const provider = {
            listCollections: vi.fn().mockRejectedValue(new Error("not authorized")),
            runCommand: vi.fn(),
        };
        const { handleError, loggerDebug } = setup(provider);

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
        expect(loggerDebug).toHaveBeenCalledTimes(1);
        const logged = loggerDebug.mock.calls[0]?.[0] as { context: string; message: string };
        expect(logged.context).toBe("create-index tool");
        expect(logged.message).toContain("not authorized");
    });

    it.each([
        ["buildInfo rejects", vi.fn().mockRejectedValue(new Error("not authorized"))],
        ["buildInfo has no versionArray", vi.fn().mockResolvedValue({})],
    ])("keeps the original error when %s", async (_label, runCommand) => {
        const { handleError } = setup({ listCollections: vi.fn().mockResolvedValue([viewInfo]), runCommand });

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
    });

    it("keeps the original error when the connection cannot be resolved", async () => {
        const { handleError, loggerDebug } = setup({}, vi.fn().mockRejectedValue(new Error("no connection")));

        const result = await handleError(namespaceNotFound(), searchArgs);

        expect(result.content[0]?.text).toBe("Error running create-index: Collection 'db.coll' does not exist.");
        expect(loggerDebug).toHaveBeenCalledTimes(1);
    });

    it("still delegates other errors to the shared MongoDB tool handling", async () => {
        const provider = { listCollections: vi.fn(), runCommand: vi.fn() };
        const { handleError } = setup(provider);

        const result = await handleError(
            new MongoDBError(ErrorCodes.AtlasSearchNotSupported, "search not supported"),
            searchArgs
        );

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("does not support vector search indexes");
        expect(provider.listCollections).not.toHaveBeenCalled();
    });
});
