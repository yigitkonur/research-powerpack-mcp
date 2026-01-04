# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.0] - 2026-01-04

### Added

- **YAML Configuration System** - All tool metadata now lives in a single `tools.yaml` file
  - Tool descriptions, parameter schemas, and validation rules centralized
  - Easy to update without touching TypeScript code
  - Single source of truth for all tool definitions

- **Handler Registry Pattern** - New `src/tools/registry.ts` with `executeTool` wrapper
  - Declarative tool registration with capability checks
  - Automatic Zod validation for all tools
  - Consistent error handling across all tools
  - Reduced routing code from 80+ lines to single function call

- **Shared Utility Functions** - New `src/tools/utils.ts`
  - `safeLog()` - Logger wrapper that never throws
  - `calculateTokenAllocation()` - Batch token distribution
  - `formatRetryHint()` - Error message formatting
  - `formatToolError()` - Standard error response builder
  - Validation helpers for arrays and bounds

- **YAML Loader Infrastructure** - New `src/config/loader.ts` and `src/config/types.ts`
  - Parses `tools.yaml` at startup
  - Generates MCP-compatible tool definitions
  - Supports both inline parameters and existing Zod schemas
  - Type-safe TypeScript interfaces for YAML config

- **Comprehensive Refactoring Documentation** - 5 design docs in `docs/refactoring/`
  - Architecture overview
  - YAML schema design specification
  - Handler registry design
  - Migration guide for adding new tools
  - Final summary with metrics

### Changed

- **`src/tools/definitions.ts`** - Reduced from 167 lines to 19 lines (-88%)
  - Now imports from YAML loader instead of hardcoded definitions

- **`src/index.ts`** - Reduced from 263 lines to 143 lines (-46%)
  - Uses `executeTool` from registry instead of if/else blocks
  - Uses `getToolCapabilities()` for startup logging

- **Build Process** - Updated to copy YAML files to dist
  - `npm run build` now includes `cp -r src/config/yaml dist/config/`

### Dependencies

- Added `yaml` package (^2.7.0) for YAML parsing

### Technical Details

- Exported `Capabilities` interface from `src/config/index.ts`
- Added index signature to `CallToolResult` for MCP SDK compatibility
- Handler wrappers accept `unknown` params with internal type casting

## [3.3.2] - Previous Release

See git history for earlier changes.
