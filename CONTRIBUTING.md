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

1. Ensure there is a Jira _Release_ ticket in the [`MCP` project](https://jira.mongodb.org/projects/MCP) for the new release and move it to _In Progress_.
2. Verify that the Jira tickets you expect to be released are correctly mapped to the expected Release version. Add any additional required documentation to the release ticket.
3. To create a new version, go to the GitHub repository Actions tab and run the "Prepare Release" workflow with one of the following options:
   - `patch` (e.g., 1.0.0 → 1.0.1) for backward-compatible bug fixes
   - `minor` (e.g., 1.0.0 → 1.1.0) for backward-compatible new features
   - `major` (e.g., 1.0.0 → 2.0.0) for breaking changes
   - A specific version number (e.g., `1.2.3`)
   - **Pre-release versions**: To create a pre-release, enter the version suffixed by `-prerelease.{n}` where `n` is the pre-release number (e.g., `1.1.0-prerelease.1`, `1.1.0-prerelease.2`). Pre-releases are release candidates that provide early access to new features before they are promoted to stable.

   > **Note**: Stable releases are published under the `latest` tag on NPM and are intended for production use. Pre-release versions are published under the `prerelease` tag and serve as release candidates for early access and feedback before being released as stable versions.

4. This creates a pull request with the version change.
5. Merge this pull request if all looks correct. This will trigger the "Publish" workflow which will publish it to **NPM**, **Docker** and the **MCP Registry**.
6. Verify that the new version is published correctly by checking:
   - NPM: https://www.npmjs.com/package/mongodb-mcp-server
   - Docker: https://hub.docker.com/r/mongodb/mongodb-mcp-server
   - MCP Registry: `curl "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.mongodb-js%2Fmongodb-mcp-server/versions/latest"`
7. Close the Jira ticket for the release.
8. Go to the [Releases](https://jira.mongodb.org/projects/MCP?selectedItem=com.atlassian.jira.jira-projects-plugin%3Arelease-page&status=released-unreleased) section the and rename the `vNext` to the new version number and mark it as Released. Create a new `vNext` for the next release.
9. Post an update in the `#mongodb-mcp` Slack channel.

### Code Quality

All pull requests automatically run through the "Code Health" workflow, which:

- Verifies code style and formatting
- Runs tests on multiple platforms (Ubuntu, macOS, Windows)

## License

By contributing to this project, you agree that your contributions will be licensed under the project's license.

## Questions?

If you have any questions or need help, please open an issue or reach out to the maintainers.
