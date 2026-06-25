import { LOG_LEVELS } from "./common.js";
import type { LogLevel } from "./common.js";

export interface Logger {
    setLevel(level: LogLevel): void;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    notice(message: string, data?: unknown): void;
    warning(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    critical(message: string, data?: unknown): void;
    alert(message: string, data?: unknown): void;
    emergency(message: string, data?: unknown): void;
}

// TODO: Tmp implementation, complete logger implementation in MCP-537
class SimpleLogger implements Logger {
    private level: LogLevel = "info";

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.level)) return;
        const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : "";
        console.error(`[${level.toUpperCase()}] ${message}${dataStr}`);
    }

    debug(message: string, data?: unknown): void {
        this.log("debug", message, data);
    }
    info(message: string, data?: unknown): void {
        this.log("info", message, data);
    }
    notice(message: string, data?: unknown): void {
        this.log("notice", message, data);
    }
    warning(message: string, data?: unknown): void {
        this.log("warning", message, data);
    }
    error(message: string, data?: unknown): void {
        this.log("error", message, data);
    }
    critical(message: string, data?: unknown): void {
        this.log("critical", message, data);
    }
    alert(message: string, data?: unknown): void {
        this.log("alert", message, data);
    }
    emergency(message: string, data?: unknown): void {
        this.log("emergency", message, data);
    }
}

export const logger: Logger = new SimpleLogger();
