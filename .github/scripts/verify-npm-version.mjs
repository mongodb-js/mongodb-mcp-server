#!/usr/bin/env node
/**
 * Fails when a version is already on npm from a different commit. `pnpm publish`
 * silently skips already-published versions, so without this guard a release could be
 * mislabeled. The source commit comes from the npm provenance attestation.
 */

const REGISTRY = "https://registry.npmjs.org";
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";

function registryPath(packageName) {
    return packageName.startsWith("@") ? `@${encodeURIComponent(packageName.slice(1))}` : packageName;
}

async function fetchJson(url) {
    return fetch(url, { headers: { accept: "application/json" } });
}

async function getPublishedCommit(packageName, packageVersion) {
    const metadataResponse = await fetchJson(
        `${REGISTRY}/${registryPath(packageName)}/${encodeURIComponent(packageVersion)}`
    );
    if (metadataResponse.status === 404) {
        return undefined;
    }
    if (!metadataResponse.ok) {
        throw new Error(`registry returned ${metadataResponse.status} for ${packageName}@${packageVersion}`);
    }

    const metadata = await metadataResponse.json();
    const attestationsUrl = metadata?.dist?.attestations?.url;
    if (!attestationsUrl) {
        throw new Error(
            `${packageName}@${packageVersion} is already published but has no provenance attestation, ` +
                `so its source commit cannot be verified. Bump the version before releasing.`
        );
    }

    const attestationsResponse = await fetchJson(attestationsUrl);
    if (!attestationsResponse.ok) {
        throw new Error(`registry returned ${attestationsResponse.status} for ${attestationsUrl}`);
    }
    const attestations = await attestationsResponse.json();
    const provenance = (attestations.attestations ?? []).find((a) => a.predicateType === SLSA_PROVENANCE);
    if (!provenance) {
        throw new Error(`${packageName}@${packageVersion} has no SLSA provenance attestation`);
    }

    const payload = provenance.bundle?.dsseEnvelope?.payload;
    if (!payload) {
        throw new Error(`${packageName}@${packageVersion} has an empty provenance payload`);
    }
    const statement = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const commit = (statement?.predicate?.buildDefinition?.resolvedDependencies ?? [])
        .map((dependency) => dependency?.digest?.gitCommit)
        .find(Boolean);
    if (!commit) {
        throw new Error(`${packageName}@${packageVersion} provenance does not record a source commit`);
    }

    return commit;
}

async function main() {
    const [packageName, packageVersion, expectedCommit] = process.argv.slice(2);
    if (!packageName || !packageVersion || !expectedCommit) {
        throw new Error("usage: verify-npm-version.mjs <package-name> <package-version> <expected-commit>");
    }
    if (packageVersion === "0.0.0") {
        console.log(`Skipping ${packageName}@${packageVersion}: placeholder version`);
        return;
    }

    const publishedCommit = await getPublishedCommit(packageName, packageVersion);
    if (!publishedCommit) {
        console.log(`✓ ${packageName}@${packageVersion} is not published yet`);
        return;
    }
    if (publishedCommit !== expectedCommit) {
        throw new Error(
            `${packageName}@${packageVersion} is already published from commit ${publishedCommit}, but this release is for ` +
                `${expectedCommit}. pnpm would silently skip the publish and the release would be mislabeled. Bump the version and retry.`
        );
    }
    console.log(`✓ ${packageName}@${packageVersion} is already published from ${expectedCommit} (idempotent re-run)`);
}

main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
});
