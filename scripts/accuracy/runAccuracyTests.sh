#!/bin/sh
# Variables necessary for the accuracy test runs
export MDB_ACCURACY_RUN_ID=$(npx uuid v4)

# For providing access tokens for different LLM providers
# export MDB_OPEN_AI_API_KEY=""
# export MDB_GEMINI_API_KEY=""
# export MDB_AZURE_OPEN_AI_API_KEY=""
# export MDB_AZURE_OPEN_AI_API_URL=""

# For providing a mongodb based storage to store accuracy result
# export MDB_ACCURACY_MDB_URL=""
# export MDB_ACCURACY_MDB_DB=""
# export MDB_ACCURACY_MDB_COLLECTION=""

# By default we run all the tests under tests/accuracy folder unless a path is
# specified in the command line. Such as:
# npm run test:accuracy -- tests/accuracy/some-test.test.ts
echo "Running accuracy tests with MDB_ACCURACY_RUN_ID '$MDB_ACCURACY_RUN_ID'"
vitest --config vitest.config.ts --project=accuracy --coverage=false --run "$@"

# Preserving the exit code from test run to correctly notify in the CI
# environments when the tests fail.
TEST_EXIT_CODE=$?

# Each test run submits an accuracy result with the accuracyRunStatus:
# "in-progress". When all the tests are done and jest exits with an exit code of
# 0, we can safely mark accuracy run as finished otherwise failed.

# This "outside-the-test-status-update" is arising out of the fact that each
# test suite stores their own accuracy run data in the storage and this setup
# might lead to data inconsistency when the tests fail. To overcome that each
# accuracy result entry has a status which by default is "in-progress" and is
# updated when the tests either pass (all our accuracy tests are supposed to
# pass unless some errors occurs during the test runs), or fail.

# This is necessary when comparing one accuracy run with another as we wouldn't
# want to compare against an incomplete run.
export MDB_ACCURACY_RUN_STATUS=$([ $TEST_EXIT_CODE -eq 0 ] && echo "done" || echo "failed")
npx tsx scripts/accuracy/updateAccuracyRunStatus.ts || echo "Warning: Failed to update accuracy run status to '$MDB_ACCURACY_RUN_STATUS'"

# This is optional but we do it anyways to generate a readable summary of report.
npx tsx scripts/accuracy/generateTestSummary.ts || echo "Warning: Failed to generate test summary HTML report"

exit $TEST_EXIT_CODE