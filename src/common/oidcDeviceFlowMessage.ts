/**
 * Builds the user-facing instruction shown when an OIDC connection needs to be
 * finished via the device-authorization flow.
 *
 * Shared between the `connect` tool (which surfaces it directly in its response)
 * and the connection-error handler (which appends it when a data operation runs
 * before authentication completed) so the two surfacings cannot drift.
 */
export function oidcDeviceFlowMessage(oidcLoginUrl: string | undefined, oidcUserCode: string | undefined): string {
    return `The user needs to finish their OIDC connection by opening '${oidcLoginUrl}' in the browser and use the following user code: '${oidcUserCode}'`;
}
