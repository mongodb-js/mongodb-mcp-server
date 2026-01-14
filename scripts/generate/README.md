# Generate Scripts

This folder contains a helper script which generates various documentation and configurations based on our code.

## Files

- **`index.ts`** - Main entry point that orchestrates all generation tasks
- **`generateArguments.ts`** - Generates CLI arguments, environment variables, and configuration tables from the UserConfig Zod Schema
- **`generateToolDocumentation.ts`** - Generates tool documentation by reading from the AllTools array

## Usage

Run all generators:

```bash
pnpm run generate:arguments
```
