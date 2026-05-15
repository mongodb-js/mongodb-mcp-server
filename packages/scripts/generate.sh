#!/usr/bin/env bash

set -Eeou pipefail

# Get the workspace root (parent of packages/scripts)
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$REPO_ROOT"

curl -Lo ./packages/scripts/spec.json https://github.com/mongodb/openapi/raw/refs/heads/main/openapi/v2/openapi-2025-03-12.json
pnpm --filter @mongodb-js/mcp-scripts filter:openapi > ./packages/scripts/filteredSpec.json < ./packages/scripts/spec.json
redocly bundle --ext json --remove-unused-components ./packages/scripts/filteredSpec.json --output ./packages/scripts/bundledSpec.json
openapi-typescript ./packages/scripts/bundledSpec.json --root-types-no-schema-prefix --root-types --output ./packages/atlas-api-client/openapi.d.ts
pnpm --filter @mongodb-js/mcp-scripts apply:openapi --spec ./packages/scripts/bundledSpec.json --file ./packages/atlas-api-client/src/apiClient.ts
prettier --write ./packages/atlas-api-client/openapi.d.ts ./packages/atlas-api-client/src/apiClient.ts
rm -rf ./packages/scripts/bundledSpec.json ./packages/scripts/filteredSpec.json ./packages/scripts/spec.json
