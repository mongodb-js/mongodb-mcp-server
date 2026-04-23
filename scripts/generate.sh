#!/usr/bin/env bash

set -Eeou pipefail

curl -Lo ./scripts/spec.json https://github.com/mongodb/openapi/raw/refs/heads/main/openapi/v2/openapi-2025-03-12.json
tsx ./scripts/filter.ts > ./scripts/filteredSpec.json < ./scripts/spec.json
redocly bundle --ext json --remove-unused-components ./scripts/filteredSpec.json --output ./scripts/bundledSpec.json
openapi-typescript ./scripts/bundledSpec.json --root-types-no-schema-prefix --root-types --output ./src/common/atlas/openapi.d.ts
tsx ./scripts/apply.ts --spec ./scripts/bundledSpec.json --file ./src/common/atlas/apiClient.ts
prettier --write ./src/common/atlas/openapi.d.ts ./src/common/atlas/apiClient.ts
rm -rf ./scripts/bundledSpec.json ./scripts/filteredSpec.json ./scripts/spec.json
