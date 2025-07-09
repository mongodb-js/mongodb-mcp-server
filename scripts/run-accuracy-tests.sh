#!/bin/sh
# Variables necessary for the accuracy test runs
export MDB_ACCURACY_RUN_ID=$(npx uuid v4)

# For providing access tokens for different LLM providers
# export MDB_OPEN_AI_API_KEY=""
# export MDB_GEMINI_API_KEY=""
# export MDB_AZURE_OPEN_AI_API_KEY=""
# export MDB_AZURE_OPEN_AI_API_URL=""

# For providing a mongodb based storage to store accuracy snapshots
# export MDB_ACCURACY_MDB_URL=""
# export MDB_ACCURACY_MDB_DB=""
# export MDB_ACCURACY_MDB_COLLECTION=""

# By default we run all the tests under tests/accuracy folder unless a path is
# specified in the command line. Such as:
# npm run test:accuracy -- tests/accuracy/some-test.test.ts
TEST_PATH_PATTERN="${1:-tests/accuracy}"
shift || true
node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern "$TEST_PATH_PATTERN" "$@"

# Each test run submits an accuracy snapshot entry for each prompt with the
# accuracyRunStatus: "in-progress". When all the tests are done and jest exits
# with an exit code of 0, we can safely mark accuracy run as finished otherwise
# failed.
JEST_EXIT_CODE=$?
if [ $JEST_EXIT_CODE -eq 0 ]; then
  MDB_ACCURACY_RUN_STATUS="done" npx tsx scripts/update-accuracy-run-status.ts || echo "Warning: Failed to update accuracy run status to 'done'"
else
  MDB_ACCURACY_RUN_STATUS="failed" npx tsx scripts/update-accuracy-run-status.ts || echo "Warning: Failed to update accuracy run status to 'failed'"
fi

# Preserve the original Jest exit code for CI
exit $JEST_EXIT_CODE