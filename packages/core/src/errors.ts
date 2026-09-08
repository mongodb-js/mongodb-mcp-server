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
 * Thrown by a tool's `execute()` when the supplied arguments fail validation
 * that the caller can fix by retrying with corrected input.
 */
export class ToolArgumentValidationError extends UserFacingError {
    constructor(message: string) {
        super(message);
        this.name = "ToolArgumentValidationError";
    }
}
