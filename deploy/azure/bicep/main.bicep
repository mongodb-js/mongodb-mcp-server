@description('Name of the Container Apps Environment. Leave blank to create a new one.')
param containerAppEnvName string = ''

@description('Location of resources')
param location string = resourceGroup().location

@description('Name of the Container App')
param containerAppName string = 'mongo-mcp-server-app'

@description('Docker image to deploy')
param containerImage string = 'mongodb/mongodb-mcp-server:1.2.0'

@description('Container CPU (vCPU) as string. Allowed: 0.25 - 2.0 in 0.25 increments')
@allowed([
  '0.25'
  '0.5'
  '0.75'
  '1.0'
  '1.25'
  '1.5'
  '1.75'
  '2.0'
])
param containerCpu string = '1.0'

// Convert CPU string to number (Bicep lacks float type; json() parses to number)
var containerCpuNumber = json(containerCpu)

@description('Container Memory (GB)')
@allowed([
  '0.5Gi'
  '1Gi'
  '2Gi'
  '4Gi'
])
param containerMemory string = '2Gi'

@description('Container App Environment Variables')
param appEnvironmentVars object = {
  MDB_MCP_READ_ONLY: 'true' // set to 'false' to enable write operations
  MDB_MCP_HTTP_PORT: '8080'
  MDB_MCP_HTTP_HOST: '::'
  MDB_MCP_TRANSPORT: 'http'
  MDB_MCP_LOGGERS: 'disk,mcp,stderr'
  MDB_MCP_LOG_PATH: '/tmp/mongodb-mcp'
}

@description('Authentication mode toggle for the Container App. NOAUTH disables platform auth; MicrosoftMIBasedAuth enables Azure AD auth and enforces 401 for unauthenticated requests.')
@allowed([
  'NOAUTH'
  'MicrosoftMIBasedAuth'
])
param authMode string = 'NOAUTH'

@description('Azure AD Application (client) ID used when authMode is MicrosoftMIBasedAuth. Leave blank for NOAUTH.')
param authClientId string = ''

@description('Issuer URL (OpenID issuer) when authMode is MicrosoftMIBasedAuth. Example: https://login.microsoftonline.com/<tenant-id>/v2.0 or https://sts.windows.net/<tenant-id>/v2.0')
param authIssuerUrl string = ''

@description('Azure AD Tenant ID (GUID) used when authMode is MicrosoftMIBasedAuth. Provided separately to avoid hard-coded cloud endpoints in template logic.')
param authTenantId string = ''

@description('Optional array of allowed client application IDs. If empty, all applications are allowed (not recommended).')
param authAllowedClientApps array = []

@secure()
@description('MongoDB Connection String')
param mdbConnectionString string

// Create Container App Environment if not provided
resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-02-02-preview' = if (empty(containerAppEnvName)) {
  name: 'mcp-env-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {}
}

// Get the Container App Environment resource ID (either existing or newly created)
var envResourceId = empty(containerAppEnvName) 
  ? containerAppEnv.id 
  : resourceId('Microsoft.App/managedEnvironments', containerAppEnvName)

// Build environment variables array
var envVarsArray = [
  for item in items(appEnvironmentVars): {
    name: item.key
    value: string(item.value)
  }
]

// Additional environment variables injected when MicrosoftMIBasedAuth is enabled (merged after user-provided vars so user can override if desired)
var authEnvVars = authMode == 'MicrosoftMIBasedAuth'
  ? concat([
      {
        name: 'MDB_MCP_HTTP_AUTH_MODE'
        value: 'azure-managed-identity'
      }
      {
        // Tenant ID of the Azure AD tenant
        name: 'MDB_MCP_AZURE_MANAGED_IDENTITY_TENANT_ID'
        value: authTenantId
      }
      {
        // Client ID of the Azure AD App representing your container app
        name: 'MDB_MCP_AZURE_MANAGED_IDENTITY_CLIENT_ID'
        value: authClientId
      }
    ], length(authAllowedClientApps) > 0 ? [
      {
        // Comma-separated list of allowed Client App IDs for access
        // (only listed Client Apps are allowed if client apps specified)
        name: 'MDB_MCP_AZURE_MANAGED_IDENTITY_ALLOWED_APP_IDS'
        value: join(authAllowedClientApps, ',')
      }
    ] : [])
  : [
      {
        name: 'MDB_MCP_HTTP_AUTH_MODE'
        value: 'none'
      }
    ]

// Deploy Container App
resource containerApp 'Microsoft.App/containerApps@2024-02-02-preview' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: envResourceId
    configuration: {
      ingress: {
        external: true
        targetPort: int(appEnvironmentVars.MDB_MCP_HTTP_PORT)
        transport: 'auto'
      }
      secrets: [
        {
          name: 'mdb-mcp-connection-string'
          value: mdbConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcpserver'
          image: containerImage
          resources: {
            cpu: containerCpuNumber
            memory: containerMemory
          }
          env: concat(
            envVarsArray,
            authEnvVars,
            [
              {
                name: 'MDB_MCP_CONNECTION_STRING'
                secretRef: 'mdb-mcp-connection-string'
              }
            ]
          )
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
        rules: [] // disables autoscaling
      }
    }
  }
}

// Container App Authentication (child resource) - only deployed when MicrosoftMIBasedAuth selected
resource containerAppAuth 'Microsoft.App/containerApps/authConfigs@2024-10-02-preview' = if (authMode == 'MicrosoftMIBasedAuth') {
  name: 'current'
  parent: containerApp
  properties: {
    platform: {
      enabled: true
      // runtimeVersion optional
    }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
      redirectToProvider: 'azureActiveDirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: authClientId
          openIdIssuer: authIssuerUrl
        }
        validation: {
          allowedAudiences: [
            authClientId
          ]
          // defaultAuthorizationPolicy allows restriction to specific client applications
          defaultAuthorizationPolicy: length(authAllowedClientApps) > 0 ? {
            allowedApplications: authAllowedClientApps
          } : null
          jwtClaimChecks: length(authAllowedClientApps) > 0 ? {
            allowedClientApplications: authAllowedClientApps
          } : null
        }
      }
    }
  }
}

output containerAppUrl string = containerApp.properties.configuration.ingress.fqdn
