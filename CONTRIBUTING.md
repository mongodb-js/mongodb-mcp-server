# Contributing to MongoDB MCP Server

Thank you for your interest in contributing to the MongoDB MCP Server project! This document provides guidelines and instructions for contributing.

## Project Overview

This project implements a Model Context Protocol (MCP) server for MongoDB and MongoDB Atlas, enabling AI assistants to interact with MongoDB Atlas resources through natural language.

## Development Setup

### Prerequisites

- Node.js (v20 or later)
- npm

### Getting Started

1. Clone the repository:

   ```
   git clone https://github.com/mongodb-labs/mongodb-mcp-server.git
   cd mongodb-mcp-server
   ```

2. Install dependencies:

   ```
   npm install
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
   npm run inspect
   ```

4. Commit your changes using [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) format.

## Adding tests to the MCP Server

When adding new features or fixing bugs, please ensure that you also add tests to cover your changes. This helps maintain the quality and reliability of the codebase.

## Running Tests

The tests can be found in the `tests` directory.

You can run tests using the following npm scripts:

- `npm test`: Run all tests

To run a specific test file or directory:

```bash
npm test -- path/to/test/file.test.ts
npm test -- path/to/directory
```

## Troubleshooting

### Restart Server

- Run `npm run build` to re-build the server if you made changes to the code
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
npm run inspect
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

Our release process is automated using GitHub Actions workflows:

### Version Bumping

1. To create a new version, go to the GitHub repository Actions tab
2. Select the "Version Bump" workflow
3. Click "Run workflow" and choose one of the following options:
   - `patch` (e.g., 1.0.0 → 1.0.1) for backward-compatible bug fixes
   - `minor` (e.g., 1.0.0 → 1.1.0) for backward-compatible new features
   - `major` (e.g., 1.0.0 → 2.0.0) for breaking changes
   - A specific version number (e.g., `1.2.3`)
4. This creates a pull request with the version change
5. Once approved and merged, the version is updated

### Automatic Publishing

When a version bump is merged to the main branch:

1. The "Publish" workflow automatically runs
2. It checks if the version already exists as a git tag
3. If the version is new, it:
   - Builds the package
   - Publishes to NPM
   - Creates a git tag for the version
   - Creates a GitHub release with auto-generated release notes

### Code Quality

All pull requests automatically run through the "Code Health" workflow, which:

- Verifies code style and formatting
- Runs tests on multiple platforms (Ubuntu, macOS, Windows)

## License

By contributing to this project, you agree that your contributions will be licensed under the project's license.

## Questions?

If you have any questions or need help, please open an issue or reach out to the maintainers.
