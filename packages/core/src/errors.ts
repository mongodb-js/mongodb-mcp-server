/**
 * Base class for errors that should be shown to users.
 * These errors contain messages that are safe to display to end users
 * and don't expose sensitive internal details.
 */
export class UserFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UserFacingError";
    }
}

/**
 * Thrown from `execute()` when the user declines confirmation or elicited input.
 * ToolBase preserves the message and records a declined outcome without invoking
 * subclass error handlers. Configured pre-execution confirmations are handled
 * directly by ToolBase and do not need to throw this error.
 */
export class ConfirmationDeclinedError extends UserFacingError {
    constructor(message: string) {
        super(message);
        this.name = "ConfirmationDeclinedError";
    }
}

/**
 * Thrown by a tool's `execute()` when the supplied arguments fail validation
 * that the caller can fix by retrying with corrected input.
 */
export class ToolArgumentValidationError extends UserFacingError {
    constructor(message: string) {
        super(message);
        this.name = "ToolArgumentValidationError";
    }
}
