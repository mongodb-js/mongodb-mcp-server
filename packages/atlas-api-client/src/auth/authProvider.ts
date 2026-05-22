export interface AccessToken {
    access_token: string;
    expires_at?: number;
}

/**
 * AuthProvider is a pluggable strategy that injects auth data into outbound Atlas API requests
 * (for example "Authorization: Bearer <token>").
 * Implementations may cache auth state and support revocation or cleanup.
 */
export interface AuthProvider {
    // Used to validate the provider was built with usable config, and is ready to auth requests.
    validate(): Promise<boolean>;
    // Get the auth headers for a request that needs to be authenticated.
    getAuthHeaders(): Promise<Record<string, string> | undefined>;
    // Clear or invalidate any auth state this provider owns (cached tokens, refresh tokens, sessions).
    // Implement as a no op if not applicable.
    revoke(): Promise<void>;
}
