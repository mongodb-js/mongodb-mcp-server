#!/usr/bin/env node
import fetch from "node-fetch";

if (process.env.MONGOSH_E2E_TEST_CURL_ALLOW_INVALID_TLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// fetch() an URL and ignore the response body
(async function () {
    (await fetch(process.argv[2])).body?.resume();
})().catch((err) => {
    process.nextTick(() => {
        throw err;
    });
});
