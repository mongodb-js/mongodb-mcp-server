import type express from "express";

const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "[::]"]);
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

export type HostOriginValidationOptions = {
    /** Returns the resolved listening port (handles ephemeral `port: 0`). */
    getResolvedPort: () => number;
    /** Configured bind host (`httpOptions.host`). */
    bindHost: string;
    /** Optional additional allowed `Host` header values. */
    allowedHosts?: string[];
    /** Optional additional allowed `Origin` header values. */
    allowedOrigins?: string[];
};

export function isWildcardHost(host: string): boolean {
    return WILDCARD_HOSTS.has(host.trim().toLowerCase());
}

export function formatHostForHeader(host: string): string {
    const trimmed = host.trim().toLowerCase();
    if (trimmed.includes(":") && !trimmed.startsWith("[")) {
        return `[${trimmed}]`;
    }
    return trimmed;
}

/**
 * Parses and normalizes an HTTP(S) `Origin` header value.
 * Returns `null` for `"null"`, non-HTTP(S) schemes, credentials, paths, queries,
 * fragments, or malformed values.
 */
export function normalizeOrigin(origin: string): string | null {
    const trimmed = origin.trim();
    if (!trimmed || trimmed.toLowerCase() === "null") {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
    }

    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        return null;
    }

    // RFC 6454 Origin headers have no path component. Reject values like
    // "http://localhost:3000/foo" or trailing slashes on incoming headers.
    const schemeEnd = parsed.protocol.length + 2; // after "http://" or "https://"
    if (trimmed.indexOf("/", schemeEnd) !== -1) {
        return null;
    }

    return parsed.origin.toLowerCase();
}

type ResolvedAllowlists = {
    port: number;
    allowedHostSet: Set<string>;
    allowedOriginSet: Set<string>;
    enforceHost: boolean;
};

function buildAllowlists(options: HostOriginValidationOptions, port: number): ResolvedAllowlists {
    const allowedHostSet = new Set<string>();
    const allowedOriginSet = new Set<string>();

    const defaultHostnames = new Set<string>(LOOPBACK_HOSTNAMES);
    const wildcard = isWildcardHost(options.bindHost);
    if (!wildcard) {
        defaultHostnames.add(formatHostForHeader(options.bindHost));
    }

    for (const hostname of defaultHostnames) {
        allowedHostSet.add(`${hostname}:${port}`);
        if (port === 80 || port === 443) {
            allowedHostSet.add(hostname);
        }

        const httpOrigin = normalizeOrigin(`http://${hostname}:${port}`);
        if (httpOrigin) {
            allowedOriginSet.add(httpOrigin);
        }
        const httpsOrigin = normalizeOrigin(`https://${hostname}:${port}`);
        if (httpsOrigin) {
            allowedOriginSet.add(httpsOrigin);
        }
    }

    const extraHosts = (options.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
    for (const host of extraHosts) {
        allowedHostSet.add(host);
    }

    const extraOrigins = options.allowedOrigins ?? [];
    for (const rawOrigin of extraOrigins) {
        // Allow operators to pass a trailing slash in config while keeping
        // incoming header validation strict.
        const cleaned = rawOrigin.trim().replace(/\/+$/, "");
        const normalized = normalizeOrigin(cleaned);
        if (normalized) {
            allowedOriginSet.add(normalized);
        }
    }

    // Enforce Host whenever bound to a concrete address, or when the operator
    // explicitly provided allowedHosts on a wildcard bind.
    const enforceHost = !wildcard || extraHosts.length > 0;

    return {
        port,
        allowedHostSet,
        allowedOriginSet,
        enforceHost,
    };
}

/**
 * Express middleware that protects the HTTP MCP transport against DNS rebinding
 * and cross-origin browser attacks by validating `Host` and `Origin` headers.
 */
export function createHostOriginValidationMiddleware(options: HostOriginValidationOptions): express.RequestHandler {
    let cached: ResolvedAllowlists | undefined;

    const getAllowlists = (): ResolvedAllowlists => {
        const port = options.getResolvedPort();
        if (!cached || cached.port !== port) {
            cached = buildAllowlists(options, port);
        }
        return cached;
    };

    // eslint-disable-next-line max-params -- express middleware callback signature
    return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
        const { allowedHostSet, allowedOriginSet, enforceHost } = getAllowlists();

        if (enforceHost) {
            const rawHost = req.headers.host;
            if (typeof rawHost !== "string" || !allowedHostSet.has(rawHost.trim().toLowerCase())) {
                res.status(403).json({ error: "Invalid Host header" });
                return;
            }
        }

        const rawOrigin = req.headers.origin;
        if (rawOrigin !== undefined) {
            if (typeof rawOrigin !== "string") {
                res.status(403).json({ error: "Invalid Origin header" });
                return;
            }
            const normalizedOrigin = normalizeOrigin(rawOrigin);
            if (!normalizedOrigin || !allowedOriginSet.has(normalizedOrigin)) {
                res.status(403).json({ error: "Invalid Origin header" });
                return;
            }
        }

        next();
    };
}
