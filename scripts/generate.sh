#!/usr/bin/env bash

set -Eeou pipefail

curl -Lo ./scripts/spec.json https://github.com/mongodb/openapi/raw/refs/heads/main/openapi/v2/openapi-2025-03-12.json
tsx ./scripts/filter.ts > ./scripts/filteredSpec.json < ./scripts/spec.json
redocly bundle --ext json --remove-unused-components ./scripts/filteredSpec.json --output ./scripts/bundledSpec.json
openapi-typescript ./scripts/bundledSpec.json --root-types-no-schema-prefix --root-types --output ./packages/atlas-api-client/openapi.d.ts
tsx ./scripts/apply.ts --spec ./scripts/bundledSpec.json --file ./packages/atlas-api-client/src/apiClient.ts
prettier --write ./packages/atlas-api-client/openapi.d.ts ./packages/atlas-api-client/src/apiClient.ts
rm -rf ./scripts/bundledSpec.json ./scripts/filteredSpec.json ./scripts/spec.json
