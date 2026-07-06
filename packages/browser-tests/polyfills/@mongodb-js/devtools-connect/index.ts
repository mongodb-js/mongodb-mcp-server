/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
export function hookLogger() {
    /* no-op */
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function connectMongoClient(url: string, options: any, logger: any, MongoClient: any): Promise<any> {
    // Remove options not understood by the plain Node.js driver
    delete options.proxy;
    delete options.applyProxyToOIDC;
    delete options.productDocsLink;
    delete options.productName;
    delete options.oidc;
    delete options.parentState;
    delete options.parentHandle;
    options.__skipPingOnConnect = true;
    const client = new MongoClient(url, options);
    await client.connect();
    return {
        client,
        state: {
            getStateShareServer() {
                return Promise.resolve("Not Available");
            },
            oidcPlugin: {
                logger,
                serialize() {
                    return Promise.resolve(undefined);
                },
            },
            destroy() {
                return Promise.resolve();
            },
        },
    };
}
