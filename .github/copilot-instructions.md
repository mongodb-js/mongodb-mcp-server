# Project Overview

This project is a server implementing the MCP (Model Context Protocol) that allows users to interact with their MongoDB clusters
and MongoDB Atlas accounts. It is built using TypeScript, Node.js and the official Anthropic
@modelcontextprotocol/sdk SDK.

## Folder Structure

- `/src`: Contains the source code of the MCP Server.
- `/src/tools`: Contains the implementation of MCP tools.
- `/src/tools/atlas/`: Contains the implementation of MCP tools that are specific to MongoDB Atlas.
- `/src/tools/mongodb/`: Contains the implementation of MCP tools that are specific to MongoDB clusters.
- `/src/resources`: Contains the implementation of MCP Resources.
- `/tests`: Contains the test code for the MCP Server.
- `/tests/accuracy`: Contains the test code for the accuracy tests, that use different models to ensure that tools have reliable descriptions.
- `/tests/integration`: Contains tests that start the MCP Server and interact with it to ensure that functionality is correct.
- `/tests/unit`: Contains simple unit tests to cover specific functionality of the MCP Server.

## Libraries and Frameworks

- Zod for message and schema validation.
- Express for the HTTP Transport implementation.
- mongosh NodeDriverServiceProvider for connecting to MongoDB.
- vitest for testing.
- @modelcontextprotocol/sdk for the protocol implementation.

## Coding Standards

- For declarations, use types. For usage, rely on type inference unless it is not clear enough.
- Always follow the eslint and prettier rule formats specified in `.eslint.config.js` and `.prettierrc.json`.
- Use classes for stateful components and functions for stateless pure logic.
- Use dependency injection to provide dependencies between components.
- Avoid using global variables as much as possible.
- New functionality MUST be under test.
  - Tools MUST HAVE integration tests.
  - Tools MUST HAVE unit tests.
  - Tools MAY HAVE accuracy tests.

## Architectural Guidelines and Best Practices

Every agent connected to the MCP Server has a Session object attached to it. The Session is the main entrypoint for
dependencies to other components. Any component that MUST be used by either a tool or a resource MUST be provided
through the Session.

### Guidelines for All Tools

- The name of the tool should describe an action: `create-collection`, `insert-many`.
- The description MUST be a simple and accurate prompt that defines what the tool does in an unambiguous way.
- All tools MUST provide a Zod schema that clearly specifies the API of the tool.
- The Operation type MUST be clear:
  - `metadata`: Reads metadata for an entity (for example, a cluster). Example: CollectionSchema.
  - `read`: Reads information from a cluster or Atlas.
  - `create`: Creates resources, like a collection or a cluster.
  - `delete`: Deletes resources or documents, like collections, documents or clusters.
  - `update`: Modifies resources or documents, like collections, documents or clusters.
  - `connects`: Connects to a MongoDB cluster.
- If a new tool is added, or the tool description is modified, the accuracy tests MUST be updated too.

### Guidelines for MongoDB Tools

- The tool category MUST be `mongodb`.
- They MUST call `this.ensureConnected()` before attempting to query MongoDB.
- They MUST return content sanitized using `formatUntrustedData`.
- Documents should be serialized with `EJSON.stringify`.
- Ensure there are proper timeout mechanisms to avoid long-running queries that can affect the server.
- Tools that require elicitation MUST implement `getConfirmationMessage` and provide an easy-to-understand message for a human running the operation.
  - If a tool requires elicitation, it must be added to `src/common/config.ts` in the `confirmationRequiredTools` list in the defaultUserConfig.

### Guidelines for Atlas Tools

- The tool category MUST be `atlas`.
