import { once } from "events";
import { readFileSync } from "fs";
import type { Server as HTTPServer, IncomingMessage, RequestListener } from "http";
import type { Server as HTTPSServer } from "https";
import { createServer as createHTTPSServer } from "https";
import type { AddressInfo } from "net";
import path from "path";
import { createServer as createHTTPServer, get as httpGet } from "http";
import DuplexPair from "duplexpair";
import { promisify } from "util";
import type { Duplex } from "stream";

function parseHTTPAuthHeader(header: string | undefined): [string, string] {
    if (!header?.startsWith("Basic ")) return ["", ""];
    const [username = "", pw = ""] = Buffer.from(header.split(" ")[1] ?? "", "base64")
        .toString()
        .split(":");
    return [username, pw];
}

export class HTTPServerProxyTestSetup {
    // Target servers: These actually handle requests.
    readonly httpServer: HTTPServer;
    readonly httpsServer: HTTPSServer;
    // Proxy servers:
    readonly httpProxyServer: HTTPServer;
    readonly httpsProxyServer: HTTPServer;
    readonly connections: Duplex[] = [];
    canTunnel: () => boolean = () => true;
    authHandler: undefined | ((username: string, password: string) => boolean);

    get httpServerPort(): number {
        return (this.httpServer.address() as AddressInfo).port;
    }
    get httpsServerPort(): number {
        return (this.httpsServer.address() as AddressInfo).port;
    }
    get httpProxyPort(): number {
        return (this.httpProxyServer.address() as AddressInfo).port;
    }
    get httpsProxyPort(): number {
        return (this.httpsProxyServer.address() as AddressInfo).port;
    }

    requests: IncomingMessage[];
    tlsOptions = Object.freeze({
        key: readFileSync(path.resolve(__dirname, "server.key")),
        cert: readFileSync(path.resolve(__dirname, "server.pem")),
    });

    constructor() {
        this.requests = [];
        const handler: RequestListener = (req, res) => {
            this.requests.push(req);
            res.writeHead(200);
            res.end(`OK ${req.url ?? ""}`);
        };
        this.httpServer = createHTTPServer(handler);
        this.httpsServer = createHTTPSServer({ ...this.tlsOptions }, handler);

        const onconnect =
            (server: HTTPServer) =>
            (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
                const [username, pw] = parseHTTPAuthHeader(req.headers["proxy-authorization"]);
                if (this.authHandler?.(username, pw) === false) {
                    socket.end("HTTP/1.0 407 Proxy Authentication Required\r\n\r\n");
                    return;
                }
                if (req.url === "127.0.0.1:1") {
                    socket.end("HTTP/1.0 502 Bad Gateway\r\n\r\n");
                    return;
                }
                socket.unshift(head);
                server.emit("connection", socket);
                socket.write("HTTP/1.0 200 OK\r\n\r\n");
            };

        this.httpProxyServer = createHTTPServer((req, res) => {
            const [username, pw] = parseHTTPAuthHeader(req.headers["proxy-authorization"]);
            if (this.authHandler?.(username, pw) === false) {
                res.writeHead(407);
                res.end();
                return;
            }
            httpGet(
                req.url ?? "<invalid>",
                {
                    createConnection: () => {
                        const sockets = new DuplexPair();
                        this.httpServer.emit("connection", sockets.socket2);
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                        return sockets.socket1;
                    },
                },
                (proxyRes) => proxyRes.pipe(res)
            );
        }).on("connect", onconnect(this.httpServer));

        this.httpsProxyServer = createHTTPServer(() => {
            throw new Error("should not use normal req/res handler");
        }).on("connect", onconnect(this.httpsServer));
    }

    async listen(): Promise<void> {
        await Promise.all(
            [this.httpServer, this.httpsServer, this.httpProxyServer, this.httpsProxyServer].map(async (server) => {
                await promisify(server.listen.bind(server, 0))();
                server.on("connection", (conn: Duplex) => this.connections.push(conn));
            })
        );
    }

    getRequestedUrls(): string[] {
        return this.requests.map((r) =>
            Object.assign(new URL(`http://_`), {
                pathname: r.url,
                host: r.headers.host,
            }).toString()
        );
    }

    async teardown(): Promise<void> {
        for (const conn of this.connections) if (!conn.destroyed) conn.destroy?.();
        const closePromises: Promise<unknown>[] = [];
        for (const server of [this.httpServer, this.httpsServer, this.httpProxyServer, this.httpsProxyServer]) {
            server.close();
            closePromises.push(once(server, "close"));
        }
        await Promise.all(closePromises);
    }
}
