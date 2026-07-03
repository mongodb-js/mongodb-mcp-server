# Contributing to MongoDB MCP Server

Thank you for your interest in contributing to the MongoDB MCP Server project! This document provides guidelines and instructions for contributing.

## Project Overview

This project implements a Model Context Protocol (MCP) server for MongoDB and MongoDB Atlas, enabling AI assistants to interact with MongoDB Atlas resources through natural language.

## Development Setup

### Prerequisites

- Node.js (v20 or later)
- pnpm

### Getting Started

1. Clone the repository:

   ```
   git clone https://github.com/mongodb-labs/mongodb-mcp-server.git
   cd mongodb-mcp-server
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

3. Add the mcp server to your IDE of choice (see the [README](README.md) for detailed client integration instructions)
   ```json
   {
     "mcpServers": {
       "MongoDB": {
         "command": "/path/to/mongodb-mcp-server/dist/esm/index.js"
       }
     }
   }
   ```

## Code Contribution Workflow

1. Create a new branch for your feature or bugfix:

   ```
   git checkout -b feature/your-feature-name
   ```

2. Make your changes, following the code style of the project

3. Run the inspector and double check your changes:

   ```
   pnpm run inspect
   ```

4. Commit your changes using [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) format.

## Adding tests to the MCP Server

When adding new features or fixing bugs, please ensure that you also add tests to cover your changes. This helps maintain the quality and reliability of the codebase.

## Running Tests

The tests can be found in the `tests` directory.

You can run tests using the following pnpm scripts:

- `pnpm test`: Run all tests

To run a specific test file or directory:

```bash
pnpm test path/to/test/file.test.ts
pnpm test path/to/directory
```

#### Accuracy Tests and colima

If you use [colima](https://github.com/abiosoft/colima) to run Docker on Mac, you will need to apply [additional configuration](https://node.testcontainers.org/supported-container-runtimes/#colima) to ensure the accuracy tests run correctly.

## Running Braintrust Evals

The Braintrust eval suite (found in `tests/eval/`) evaluates how well an LLM, when connected to the MongoDB MCP server, can understand and fulfill user requests given in natural language. Each evaluation is scored by an LLM judge, and the results are tracked over time in [Braintrust](https://www.braintrust.dev/). To run the Braintrust evals, you will need both access to a MongoDB instance (either running locally or in the cloud) and a Braintrust API key.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (needed if you plan to run a local MongoDB instance using the `mongodb/mongodb-atlas-local` Docker image)
- A [Braintrust API key](https://www.braintrust.dev/app/<organization>/p/<project>/configuration/org/api-keys), which must be set in the `BRAINTRUST_API_KEY` environment variable

### Running Locally

1. Start the local MongoDB docker container for the evals:

   ```bash
   pnpm run eval:db-start
   ```

2. Run the eval suite and upload the results to Braintrust:

   ```bash
   pnpm run eval:run
   ```

   By default, the eval is configured to use the `mongodb-education-ai` (organization) > `mongodb-mcp-server-evals` (project) > `Search` (dataset) in MongoDB's Braintrust organization.

   Additional useful scripts:
   - `pnpm run eval:debug` — runs the eval directly using `tsx`, which can be simpler for local debugging. `pnpm run eval:run` also works if used with VSCode's "JavaScript Debug Terminal".
   - `pnpm run eval:serve` — launches Braintrust in dev mode, which can serve requests directly if Braintrust playground is configured with Remote Eval set to "http://localhost:8300"
   - `pnpm run eval:ci:run` — used in CI: fetches eval history for the `main` branch, runs the eval suite on current working directory with the experiment baseline set to the latest `main-<number>` run (to compare against), and writes a markdown report to `.eval/ci-report.md` which will be posted as a sticky PR comment.
   - `pnpm run eval:push` — bundles the eval and pushes it to Braintrust to be used as [sandbox Eval](https://www.braintrust.dev/docs/evaluate/remote-evals#run-a-sandbox-eval).
   - `pnpm run eval:generate-schemas` — generates json schema for the input and expected fields of the eval dataset which can be set on Braintrust for better validation.

3. Feel free to stop the local MongoDB instance when you are done:

   ```bash
   pnpm run eval:db-stop
   ```

#### Notable Environment Variables

- `BRAINTRUST_API_KEY`: Required for all eval runs.
- `BRAINTRUST_API_KEY_OVERRIDE`: When running in dev mode (`pnpm run eval:serve`), there is a known issue where Braintrust substitutes your `BRAINTRUST_API_KEY` with a temporary token that will not work with the Braintrust gateway. To work around this, we also set your actual API key in the `BRAINTRUST_API_KEY_OVERRIDE` environment variable. The eval logic is designed to prioritize this variable, ensuring the eval process uses your real API key.
  More info: https://www.braintrust.dev/docs/kb/gateway-calls-fail-in-bt-eval-dev-mode
- `BT_EVAL_PARAMS_JSON`: JSON string of parameters to override the default parameters for the eval.
- `EVAL_BASE_EXPERIMENT_NAME`: Lets you compare the current run against a specific baseline experiment. In CI, this is set automatically from the latest `main-<number>` run.
- `GIT_BRANCH_NAME`: The git branch name for the eval run. It is attached to the experiment as `metadata.git_branch_name` in Braintrust, allowing you to filter and group results by branch. In CI, this lets us compare accuracy rates between the main branch and the PR.

### Running in CI

The `Braintrust Evals` GitHub Actions workflow (`.github/workflows/braintrust-evals.yml`) runs the suite against a local MongoDB and reports results. It is triggered by:

- manual runs (`workflow_dispatch`)
- pushes to the `main` branch
- pull requests with the `braintrust-evals` label

To kick off an eval on a PR, add the `braintrust-evals` label. The workflow runs `pnpm run eval:ci:run`, generates a report in `.eval/ci-report.md`, and posts it as a sticky PR comment. This report includes the current `llm_judge` accuracy as well as a chart showing accuracy over time compared to the latest `main-<number>` baseline.

## Troubleshooting

### Restart Server

- Run `pnpm run build` to re-build the server if you made changes to the code
- Press `Cmd + Shift + P` and type List MCP Servers
- Select the MCP server you want to restart
- Select the option to restart the server

### View Logs

To see MCP logs, check https://code.visualstudio.com/docs/copilot/chat/mcp-servers.

- Press `Cmd + Shift + P` and type List MCP Servers
- Select the MCP server you want to see logs for
- Select the option to view logs in the output panel

### Debugging

For debugging, we use the MCP inspector tool. From the root of this repository, run:

```shell
pnpm run inspect
```

This is equivalent to:

```shell
npx @modelcontextprotocol/inspector -- node dist/esm/index.js
```

## Pull Request Guidelines

1. Update documentation if necessary
2. Ensure your PR includes only relevant changes
3. Link any related issues in your PR description
4. Keep PRs focused on a single topic

## Code Standards

- Use TypeScript for all new code
- Follow the existing code style (indentation, naming conventions, etc.)
- Comment your code when necessary, especially for complex logic
- Use meaningful variable and function names

## Making public API changes

To ensure no unintentional public API changes are introduced, the project uses [API Extractor](https://api-extractor.com/) to track the public-facing API across package entry points. The generated API report files live in `api-extractor/reports/` and are checked into source control.

### Workflow when changing the public API

1. Make your code changes.
2. Run `pnpm run update:api` to regenerate the reports.
3. Review the diff in `api-extractor/reports/`.
4. Commit the updated reports alongside your code changes.

If you forget to update the reports, `pnpm run check:api` will fail.

## Reporting Issues

When reporting issues, please include:

- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Version information
- Environment details

## Adding New Tools

When adding new tools to the MCP server:

1. Follow the existing pattern in `server.ts`
2. Define clear parameter schemas using Zod
3. Implement thorough error handling
4. Add proper documentation for the tool
5. Include examples of how to use the tool

## Release Process

To release a new version of the MCP server, follow these steps:

1. To create a new version, go to the GitHub repository Actions tab and run the "Prepare Release" workflow with one of the following options:
   - `patch` (e.g., 1.0.0 → 1.0.1) for backward-compatible bug fixes
   - `minor` (e.g., 1.0.0 → 1.1.0) for backward-compatible new features
   - `major` (e.g., 1.0.0 → 2.0.0) for breaking changes
   - A specific version number (e.g., `1.2.3`)
   - **Pre-release versions**: To create a pre-release, enter the version suffixed by `-prerelease.{n}` where `n` is the pre-release number (e.g., `1.1.0-prerelease.1`, `1.1.0-prerelease.2`). Pre-releases are release candidates that provide early access to new features before they are promoted to stable.

   > **Note**: Stable releases are published under the `latest` tag on NPM and are intended for production use. Pre-release versions are published under the `prerelease` tag and serve as release candidates for early access and feedback before being released as stable versions.

2. This creates a pull request with the version change. The PR body includes a summary of the Jira `vNext` ticket status — check it for any unresolved tickets and ensure they are either resolved or moved out of `vNext` before merging.
3. Merge this pull request if all looks correct. This will trigger the "Publish" workflow which will publish it to **NPM**, **Docker** and the **MCP Registry**. It will also automatically rename the Jira `vNext` version to the released version number and create a new `vNext` for the next release.
4. Verify that the new version is published correctly by checking:
   - NPM: https://www.npmjs.com/package/mongodb-mcp-server
   - Docker: https://hub.docker.com/r/mongodb/mongodb-mcp-server
   - MCP Registry: `curl "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.mongodb-js%2Fmongodb-mcp-server/versions/latest"`
5. Post an update in the `#mongodb-mcp` Slack channel.

### Code Quality

All pull requests automatically run through the "Code Health" workflow, which:

- Verifies code style and formatting
- Runs tests on multiple platforms (Ubuntu, macOS, Windows)

## License

By contributing to this project, you agree that your contributions will be licensed under the project's license.

## Questions?

If you have any questions or need help, please open an issue or reach out to the maintainers.
