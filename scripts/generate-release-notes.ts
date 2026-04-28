#!/usr/bin/env -S node --experimental-strip-types
// Generates release notes combining an AI summary with structured GitHub release notes.
//
// Usage: node --experimental-strip-types scripts/generate-release-notes.ts [--newVersion <version>] [--commitSha <sha>]

import { execSync } from "child_process";
import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SemVer } from "semver";
import semver from "semver";
import { simpleGit } from "simple-git";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createParseArgs } from "@mongosh/arg-parser/arg-parser";
import { z } from "zod";

const {
    parsed: { newVersion, commitSha },
} = createParseArgs({
    schema: z.object({
        newVersion: z.string().default("vNext"),
        commitSha: z.string().optional(),
    }),
})({ args: process.argv.slice(2) });

const GROVE_API_KEY = process.env["GROVE_API_KEY"];

async function getAllVersionTags(): Promise<SemVer[]> {
    const tags = await simpleGit().tags();
    return tags.all
        .map((tag) => semver.parse(stripV(tag)))
        .filter((tag) => tag !== null)
        .sort((a, b) => semver.rcompare(a, b));
}

function stripV(tag: string): string {
    return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** Finds the appropriate previous tag to compare against based on version type. */
async function findPrevTag(newVersion: string): Promise<SemVer | null> {
    const versionStr = stripV(newVersion);
    const parsed = semver.parse(versionStr);

    if (!parsed || newVersion === "vNext") {
        // Fallback for non-semver or vNext: use git describe
        try {
            const result = await simpleGit().raw(["describe", "--tags", "--abbrev=0", "HEAD^"]);
            return semver.parse(stripV(result.trim())) || null;
        } catch {
            return null;
        }
    }

    const allTags = await getAllVersionTags();
    const isPrerelease = parsed.prerelease.length > 0;

    if (!isPrerelease) {
        // Stable release: find the most recent previous stable release
        return allTags.find((tag) => tag.prerelease.length === 0 && semver.lt(tag, versionStr)) ?? null;
    }

    // Prerelease: find the most recent release lower than the current version,
    // regardless of whether it's stable or prerelease,
    return allTags.find((tag) => semver.lt(tag, versionStr)) ?? null;
}

/** Returns an AI-generated summary of the release, or null if generation fails or there are no relevant PRs. */
async function generateAiSummary(prevTagDate: string): Promise<string | null> {
    // Fetch feat/fix PR titles and bodies merged since the previous tag
    type PrItem = { title: string; body: string };
    const prListJson = execSync(
        `gh pr list --state merged --base main --search "merged:>${prevTagDate}" --json title,body --limit 500`,
        { encoding: "utf-8" }
    ).trim();
    const prList = JSON.parse(prListJson) as PrItem[];
    const featFixPrs = prList.filter((pr) => /^(feat|fix)(\(|!|:)/.test(pr.title));

    if (!featFixPrs.length) {
        return null;
    }

    const prSummaries = featFixPrs
        .map((pr) => (pr.body?.trim() ? `- ${pr.title}\n${pr.body.trim()}` : `- ${pr.title}`))
        .join("\n\n");

    if (!GROVE_API_KEY) {
        console.log("GROVE_API_KEY is not set, skipping AI summary generation");
        return null;
    }

    const anthropic = createAnthropic({
        baseURL: "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic/v1",
        apiKey: GROVE_API_KEY,
        headers: { "api-key": GROVE_API_KEY },
    });

    const prompt = [
        "You are writing release notes for MongoDB MCP Server, a tool that lets AI assistants interact with MongoDB databases and MongoDB Atlas.",
        "Given these merged PR titles, write 2-3 sentences for end-users describing what's new in plain English.",
        "Be concrete and avoid internal jargon. Only describe user-visible changes.",
        "Focus primarily on new features (feat: titles) — mention bug fixes only if they address something particularly significant.",
        "Respond with the release notes summary only, without any introductory text or formatting.",
        `PRs:\n${prSummaries}`,
    ].join(" ");

    try {
        const { text } = await generateText({
            model: anthropic("claude-sonnet-4-6"),
            messages: [{ role: "user", content: prompt }],
            maxOutputTokens: 10000,
        });
        return text || null;
    } catch (err) {
        console.log(`AI summary generation failed: ${String(err)}, using structured notes only`);
        return null;
    }
}

async function main(): Promise<void> {
    const git = simpleGit();
    const resolvedCommitSha = commitSha || (await git.revparse("HEAD"));
    const prevTag = await findPrevTag(newVersion);

    if (!prevTag) {
        console.log("No previous tag found, skipping release notes generation");
        process.exit(0);
    }

    console.log(`Previous tag: ${prevTag.version}`);

    // Get the committer date of the previous tag's commit in ISO 8601 strict format (%cI),
    // e.g. "2024-01-15T10:30:00+00:00". simple-git's log() only exposes author_date in a
    // fixed format, so git.raw() is needed here. The strict ISO format is required by the
    // GitHub search API's merged:> filter.
    const prevTagDate = (await git.raw(["log", "-1", "--format=%cI", `v${prevTag.version}`])).trim();
    console.log(`Previous tag date: ${prevTagDate}`);

    // Fetch feat/fix PR titles and generate AI summary
    const aiSummary = await generateAiSummary(prevTagDate);

    // Generate structured release notes via GitHub API
    const structuredNotes = execSync(
        [
            "gh api repos/mongodb-js/mongodb-mcp-server/releases/generate-notes",
            "--method POST",
            `--field tag_name=${newVersion}`,
            `--field previous_tag_name=v${prevTag.version}`,
            `--field target_commitish=${resolvedCommitSha}`,
            "--jq '.body'",
        ].join(" "),
        { encoding: "utf-8" }
    ).trim();

    const notesFile = join(import.meta.dirname, "..", "release-notes.md");

    if (aiSummary) {
        console.log("AI summary generated successfully");
        writeFileSync(notesFile, `## What's New\n\n${aiSummary}\n\n${structuredNotes}`);
    } else {
        console.log(`No AI summary generated, using structured notes only`);
        writeFileSync(notesFile, structuredNotes);
    }

    if (process.env["GITHUB_OUTPUT"]) {
        appendFileSync(process.env["GITHUB_OUTPUT"], `notes_file=${notesFile}\n`);
    } else {
        console.log(`Release notes written to: ${notesFile}`);
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
