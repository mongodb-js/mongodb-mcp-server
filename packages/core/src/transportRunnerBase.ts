/**
 * Base class for all transport runners.
 */
export abstract class TransportRunnerBase {
    protected constructor() {}

    /**
     * Starts the transport runner.
     */
    abstract start(): Promise<void>;

    /**
     * Stops the transport runner and releases any resources.
     */
    abstract close(): Promise<void>;
}
