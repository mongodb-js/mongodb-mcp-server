We need to minimize structural changes unless they match the new patterns in v2 (e.g. using { options, logger, <other injected services> } for constructors).

The following files have been found to have too much deviation from v2-move:

packages/atlas-api-client/src/apiClient.test.ts - tenantUpgrade tests seem to have been replaced with upgradeFlexToDedicated, seems like we regressed somewhere.
packages/atlas-api-client/src/apiClient.ts - let's always inject the fetch function (required) to avoid isNodeRuntime checks at this level. We could even inject createClient directly instead. upgradeSharedTierCluster and upgradeFlexToDedicated additions seem weird; we shouldn't be adding new features as part of this PR
packages/cli/src/resources/common/debug.ts - changes here seem weird, I think we shouldn't be hacking together things and come up with a cleaner solution - discuss it with me first
packages/cli/src/cliSession.ts - I think CliSession should stay as CliSession; consider mass replacement
packages/integration-tests/src/tools/atlas-local/atlasLocalHelpers.ts - why was ATLAS_LOCAL_SAMPLE_DATA_TIMEOUT_MS doubled? keep it the same, same with SAMPLE_DATA_TEST_TIMEOUT_MS
packages/integration-tests/src/tools/atlas/orgs.test.ts - structuredContent expectation was removed but should persist in the test
packages/integration-tests/src/tools/mongodb/metadata/explain.test.ts - this should use "on the requested namespace" instead of injecting the name. keep changes minimal against v2-move
packages/integration-tests/src/tools/mongodb/read/aggregate.test.ts - remove comment
packages/integration-tests/src/tools/mongodb/read/count.test.ts - recover structured content assertions, minimize bumps/changes if possible
packages/integration-tests/src/tools/mongodb/read/find.test.ts - remove added comment, recover old structured content, minimize changes
packages/integration-tests/src/tools/mongodb/update/renameCollection.test.ts - return old test assertions - this is what we expect
packages/integration-tests/src/transports/streamableHttp.test.ts - does it make sense to delete the entire "session initialization failure handling", "connection scoping" test suite? seems like a lot. add a comment in github review if there's reasoning; minimize changes if not.
packages/integration-tests/src/integrationHelpers.ts - object.assign is weird, is there no cleaner way? maybe extending the session class and adding the field?
packages/integration-tests/src/sessionStore.test.ts - minimize changes
