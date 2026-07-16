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
