# Deploy MongoDB MCP Server on Azure Container Apps

## Overview
This directory contains an Azure Bicep template (`bicep/main.bicep`) and supporting parameter files for deploying the infrastructure required to run the MongoDB MCP (Model Context Protocol) server. Use this guide to prepare prerequisites, select the appropriate parameter file, and run the deployment end-to-end.

## Prerequisites
- Azure CLI (2.55.0 or later) installed and signed in (`az login`).
- Azure subscription with permissions to deploy the required resources.
- Docker installed locally for building container images.
- Azure Container Registry (ACR) to host the MongoDB MCP server image.
- MongoDB MCP server container image available in your registry (instructions below).

## Prepare the MongoDB MCP Docker Image
If you already have a tagged image in your ACR, skip this section. Otherwise, build and push the image using the official Dockerfile:

```powershell
# 1. Clone the MongoDB MCP server repository
git clone https://github.com/mongodb-js/mongodb-mcp-server.git
cd mongodb-mcp-server

# 2. Log in to your Azure Container Registry
$acrName = "<your-acr-name>"          # without the .azurecr.io suffix
az acr login --name $acrName

# 3. Build the MongoDB MCP server image
$tag = "$acrName.azurecr.io/mongodb-mcp-server:latest"
docker build -f Dockerfile -t $tag .

# 4. Push the image to your ACR
docker push $tag
```

Record the fully qualified image name (FQIN) for later use in your parameter file, e.g. `myregistry.azurecr.io/mongodb-mcp-server:latest`.

## Parameter Files
Two sample parameter files are provided to help you tailor deployments:

- `bicep/params.json`: Baseline configuration that deploys the MongoDB MCP server with authentication disabled or using default settings. Use this when testing in development environments or when external authentication is not required.
- `bicep/paramsWithAuthEnabled.json`: Extends the baseline deployment and enables explicit authentication configuration (for example, username/password, secrets, or identity inputs). Use this when you want the server protected with credentials.

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
- Confirm the container instance or orchestration target pulled the correct MongoDB MCP image from your ACR.
- Verify networking rules (firewalls, VNet integrations, etc.) allow intended clients to reach the server endpoint.
- If using the auth-enabled parameters, validate that credentials/secrets are stored securely (Key Vault, managed identity) and tested end-to-end.
- Document any additional operational steps (scaling, logging, maintenance) based on your environment requirements.

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
