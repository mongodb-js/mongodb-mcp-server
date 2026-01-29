# Deploy MongoDB MCP Server on Azure Container Apps

## Overview

This directory contains an Azure Bicep template (`bicep/main.bicep`) and supporting parameter files for deploying the infrastructure required to run the MongoDB MCP (Model Context Protocol) server. Use this guide to prepare prerequisites, select the appropriate parameter file, and run the deployment end-to-end.

## Prerequisites

- Azure CLI (2.55.0 or later) installed and signed in (`az login`).
- Azure subscription with permissions to deploy the required resources.
- MongoDB MCP server container image available in dockerhub registry (mongodb/mongodb-mcp-server:1.2.0). Version 1.2.0 has been validated for Azure AI Foundry compatibility when the aggregate, create-index, explain, and export tools are omitted (additional tools are disabled by default for security). You can reference the `latest` tag instead if you want to experiment with newer builds.

## Parameter Files

Two sample parameter files are provided to help you tailor deployments:

- `bicep/params.json`: Baseline configuration that deploys the MongoDB MCP server with authentication disabled or using default settings. Use this when testing in development environments or when external authentication is not required.
- `bicep/paramsWithAuthEnabled.json`: Extends the baseline deployment and enables Microsoft Entra ID (Azure AD) authentication using managed identity and client application IDs. Use this when you want the server protected with Azure AD authentication via managed identity.

> **Tip:** Update the image reference, secrets, networking, and any other environment-specific values in the chosen parameter file before deployment.

### Managed Identity Authentication Parameters

When using `bicep/paramsWithAuthEnabled.json`, provide tenant and app-specific values for the following parameters before deployment:

- `authClientId`: Set to the application (client) ID of the Microsoft Entra ID app registration that represents the MongoDB MCP server API (often the managed identity or a server-side app registration).
- `authIssuerUrl`: Use the issuer URL for your tenant. Use `<authentication-endpoint>/<TENANT-ID>/v2.0`, and replace <authentication-endpoint> with the authentication endpoint for your cloud environment (for example, "https://login.microsoftonline.com" for global Azure), also replacing <TENANT-ID> with the Directory (tenant) ID in which the app registration was created.
- `authTenantId`: The tenant ID (directory ID) of the Microsoft Entra tenant that owns the identities interacting with the MCP server. Obtain it via `az account show --query tenantId -o tsv`.
- `authAllowedClientApps` (optional): Provide an array of application (client) IDs for every client that should be allowed to request tokens for the MongoDB MCP server (for example, front-end apps, automation scripts, or integration partners). Omit this property to allow all clients without any filtering.

For deeper guidance on Microsoft Entra authentication in Azure Container Apps, see the official docs: <https://learn.microsoft.com/en-us/azure/container-apps/authentication-entra>.

## Deploy the Bicep Template

1. **Set common variables (PowerShell example):**

   ```powershell
   $location = "eastus"
   $resourceGroup = "mongodb-mcp-demo-rg"
   $templateFile = "bicep/main.bicep"
   $parameterFile = "bicep/params.json"            # or bicep/paramsWithAuthEnabled.json
   ```

2. **Create the resource group (if it does not exist):**

   ```powershell
   az group create --name $resourceGroup --location $location
   ```

3. **Validate the deployment (optional but recommended):**

   ```powershell
   az deployment group what-if \
      --resource-group $resourceGroup \
      --template-file $templateFile \
      --parameters @$parameterFile
   ```

4. **Run the deployment:**

   ```powershell
   az deployment group create \
      --resource-group $resourceGroup \
      --template-file $templateFile \
      --parameters @$parameterFile
   ```

   If the deployment returns an error, rerun the command with `--debug` to surface detailed troubleshooting output.

5. **Monitor outputs:** Review the deployment outputs and logs for connection endpoints, credential references, or other values needed to complete integration.

## Post-Deployment Checklist

- After the Azure Container Apps deployment completes, access the MCP server by visiting the application’s public endpoint with /mcp appended. Example: https://[CONTAINER_APP_NAME].<region>.azurecontainerapps.io/mcp.

## Updating the Deployment

To apply changes:

1. Update the parameter file or `main.bicep` as needed.
2. Re-run the `az deployment group create` command with the same resource group.
3. Use `az deployment group what-if` to preview differences before applying them.

## Cleanup

Remove the deployed resources when no longer needed:

```powershell
az group delete --name $resourceGroup --yes --no-wait
```

> **Reminder:** Deleting the resource group removes all resources inside it. Ensure any persistent data or backups are retained elsewhere before running the cleanup command.
