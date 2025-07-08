#!/bin/sh
# Variables necessary for the accuracy test runs
export MDB_ACCURACY_RUN_ID=$(npx uuid v4)

TEST_PATH_PATTERN="${1:-tests/accuracy}"
shift || true
node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern "$TEST_PATH_PATTERN" "$@"