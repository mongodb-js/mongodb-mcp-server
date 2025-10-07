import type { Request, Response, NextFunction } from "express";
import type { UserConfig } from "../../common/config.js";
import type { LoggerBase } from "../../common/logger.js";
import { azureManagedIdentityAuthMiddleware } from "./azureManagedIdentityAuth.js";

export function createAuthMiddleware(logger: LoggerBase, userConfig: UserConfig) {
    const mode = userConfig.httpAuthMode ?? "none";
    switch (mode) {
        case "azure-managed-identity":
            return azureManagedIdentityAuthMiddleware(logger, userConfig);
        case "none":
            return (_req: Request, _res: Response, next: NextFunction) => next();
        default:
            logger.warning({
                id: 0 as any,
                context: "authMiddlewareFactory",
                message: `Unknown httpAuthMode '${mode}' - falling back to 'none'.`,
            });
            return (_req: Request, _res: Response, next: NextFunction) => next();
    }
}
