/**
 * Request context containing HTTP headers and query parameters.
 * Used by HTTP-based transports.
 */
export type TransportRequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
};

/** @deprecated Use `TransportRequestContext` instead. */
export type RequestContext = TransportRequestContext;

/**
 * A factory function that constructs a server instance for a given request.
 *
 * Concrete transport runners delegate server creation to this callback so the
 * binary entry point can supply a fully wired-up `Server`.
 */
export type IServerFactory<TServer = unknown> = (context?: {
    request?: TransportRequestContext;
}) => Promise<TServer> | TServer;

/**
 * Public surface of every transport runner.
 *
 * Transport runners are responsible for accepting incoming MCP traffic over
 * a specific transport (stdio, streamable HTTP, dry-run, in-memory, etc.) and
 * routing it to a `Server` instance produced by an `IServerFactory`.
 */
export interface ITransportRunner {
    /** Starts the transport and begins accepting traffic. */
    start(options?: unknown): Promise<void>;

    /** Closes the transport, releasing any underlying resources. */
    close(): Promise<void>;

    /** Closes only the underlying transport, leaving the runner reusable. */
    closeTransport(): Promise<void>;
}
