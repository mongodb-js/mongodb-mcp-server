export {
    ApiClient,
    createDefaultApiClient,
    type ApiClientOptions,
    type ApiClientFactoryFn,
    type RequestContext,
} from "./apiClient.js";
export { ApiClientError } from "./apiClientError.js";
export type { AuthProvider, Credentials, AccessToken, AuthProviderOptions } from "./auth/authProvider.js";
export { AuthProviderFactory } from "./auth/authProvider.js";
export type { ClientCredentialsAuthOptions } from "./auth/clientCredentials.js";
export { ClientCredentialsAuthProvider } from "./auth/clientCredentials.js";
export type { paths, operations, ApiError } from "./openapi.js";

import type { components } from "./openapi.js";
type Schemas = components["schemas"];
export type Group = Schemas["Group"];
export type ClusterDescription20240805 = Schemas["ClusterDescription20240805"];
export type FlexClusterDescription20241113 = Schemas["FlexClusterDescription20241113"];
export type ClusterConnectionStrings = Schemas["ClusterConnectionStrings"];
export type CloudDatabaseUser = Schemas["CloudDatabaseUser"];
export type DatabaseUserRole = Schemas["DatabaseUserRole"];
export type PaginatedClusterDescription20240805 = Schemas["PaginatedClusterDescription20240805"];
export type PaginatedFlexClusters20241113 = Schemas["PaginatedFlexClusters20241113"];
export type PaginatedOrgGroupView = Schemas["PaginatedOrgGroupView"];
export type PaginatedAtlasGroupView = Schemas["PaginatedAtlasGroupView"];
export type AtlasOrganization = Schemas["AtlasOrganization"];
export type PaginatedOrganizationView = Schemas["PaginatedOrganizationView"];
export type PerformanceAdvisorIndex = Schemas["PerformanceAdvisorIndex"];
export type PerformanceAdvisorResponse = Schemas["PerformanceAdvisorResponse"];
export type DropIndexSuggestionsIndex = Schemas["DropIndexSuggestionsIndex"];
export type DropIndexSuggestionsResponse = Schemas["DropIndexSuggestionsResponse"];
export type SchemaAdvisorResponse = Schemas["SchemaAdvisorResponse"];
export type SchemaAdvisorItemRecommendation = Schemas["SchemaAdvisorItemRecommendation"];
export type PerformanceAdvisorSlowQuery = Schemas["PerformanceAdvisorSlowQuery"];
