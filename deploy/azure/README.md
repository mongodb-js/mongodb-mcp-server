# Deploy MongoDB MCP Server on Azure Container Apps

## Overview

This directory contains an Azure Bicep template (`bicep/main.bicep`) and supporting parameter files for deploying the infrastructure required to run the MongoDB MCP (Model Context Protocol) server. Use this guide to prepare prerequisites, select the appropriate parameter file, and run the deployment end-to-end.

## Prerequisites

- Azure CLI (2.55.0 or later) installed and signed in (`az login`).
- Azure subscription with permissions to deploy the required resources.
- MongoDB MCP server container image available in dockerhub registry (mongodb/mongodb-mcp-server:latest).

## Parameter Files

Two sample parameter files are provided to help you tailor deployments:

- `bicep/params.json`: Baseline configuration that deploys the MongoDB MCP server with authentication disabled or using default settings. Use this when testing in development environments or when external authentication is not required.
- `bicep/paramsWithAuthEnabled.json`: Extends the baseline deployment and enables Microsoft Entra ID (Azure AD) authentication using managed identity and client application IDs. Use this when you want the server protected with Azure AD authentication via managed identity.

> **Tip:** Update the image reference, secrets, networking, and any other environment-specific values in the chosen parameter file before deployment.

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
