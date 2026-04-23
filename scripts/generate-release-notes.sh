#!/usr/bin/env bash
# Generates release notes combining an AI summary with structured GitHub release notes.
#
# Usage: scripts/generate-release-notes.sh [GIT_TAG_VERSION] [TARGET]

set -e

GIT_TAG_VERSION="${1:-vNext}"
TARGET="${2:-$(git rev-parse HEAD)}"

GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"

STRUCTURED_NOTES=$(mktemp)
trap 'rm -f "$STRUCTURED_NOTES"' EXIT

# Find the previous tag
PREV_TAG=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
if [[ -z "$PREV_TAG" ]]; then
  echo "No previous tag found, skipping release notes generation"
  exit 0
fi

echo "Previous tag: $PREV_TAG"

# Get the timestamp of the previous tag's commit
PREV_TAG_DATE=$(git log -1 --format=%cI "$PREV_TAG")

echo "Previous tag date: $PREV_TAG_DATE"

# Fetch feat/fix PR titles merged since the previous tag (server-side filtered)
FEAT_FIX_TITLES=$(gh pr list \
  --state merged --base main \
  --search "merged:>$PREV_TAG_DATE" \
  --json title \
  --jq '[.[] | .title | select(test("^(feat|fix)(\\(|!|:)"))] | join("\n")' \
  --limit 500)

# Generate structured release notes (always, regardless of AI result)
gh api repos/mongodb-js/mongodb-mcp-server/releases/generate-notes \
  --method POST \
  --field tag_name="$GIT_TAG_VERSION" \
  --field previous_tag_name="$PREV_TAG" \
  --field target_commitish="$TARGET" \
  --jq '.body' \
  > "$STRUCTURED_NOTES"

NOTES_FILE="$(git rev-parse --show-toplevel)/release-notes.md"

if [[ -z "$FEAT_FIX_TITLES" ]]; then
  echo "No feat/fix PRs found since $PREV_TAG, using structured notes only"
  cp "$STRUCTURED_NOTES" "$NOTES_FILE"
else
  PROMPT=$(printf '%s\n\nPR titles:\n%s' \
    "You are writing release notes for MongoDB MCP Server, a tool that lets AI assistants interact with MongoDB databases and MongoDB Atlas. Given these merged PR titles, write 2-3 sentences for end-users describing what's new in plain English. Be concrete and avoid internal jargon. Only describe user-visible changes. Focus primarily on new features (feat: titles) — mention bug fixes only if they address something particularly significant." \
    "$FEAT_FIX_TITLES")

  AI_RESPONSE=$(curl -s --fail \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Content-Type: application/json" \
    "https://models.inference.ai.azure.com/chat/completions" \
    -d "$(jq -n --arg prompt "$PROMPT" '{
      "model": "gpt-4o-mini",
      "messages": [{"role": "user", "content": $prompt}],
      "max_tokens": 300
    }')" | jq -r '.choices[0].message.content')

  if [[ -z "$AI_RESPONSE" || "$AI_RESPONSE" == "null" ]]; then
    echo "Empty response from GitHub Models, using structured notes only"
    cp "$STRUCTURED_NOTES" "$NOTES_FILE"
  else
    echo "AI summary generated successfully"
    {
      echo "## What's New"
      echo ""
      echo "$AI_RESPONSE"
      echo ""
      cat "$STRUCTURED_NOTES"
    } > "$NOTES_FILE"
  fi
fi

if [[ -n "$GITHUB_OUTPUT" ]]; then
  echo "notes_file=$NOTES_FILE" >> "$GITHUB_OUTPUT"
else
  echo "Release notes written to: $NOTES_FILE"
fi
