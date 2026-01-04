# MCP Server Refactoring: Architecture Overview

> **Version:** 1.0  
> **Date:** January 2026  
> **Status:** Design Complete

## Executive Summary

This document outlines the architectural refactoring of the Research Powerpack MCP Server to achieve:

1. **Single Source of Truth** - All tool metadata centralized in YAML configuration
2. **Reduced Code Repetition** - Eliminate 400+ lines of duplicate descriptions and handler patterns
3. **Handler Registry Pattern** - Clean routing with shared middleware
4. **Maintainability** - Easy to add/modify tools without touching multiple files

---

## Current State Analysis

### Problems Identified

| Problem | Location | Impact | Lines Affected |
|---------|----------|--------|----------------|
| **Hardcoded tool descriptions** | `src/tools/definitions.ts` | Descriptions duplicated, hard to update | ~150 lines |
| **Inline schema descriptions** | `src/schemas/*.ts` | `.describe()` strings scattered, duplicated with definitions | ~200 lines |
| **Repetitive handler routing** | `src/index.ts` | 5 identical if/else blocks with same pattern | ~80 lines |
| **Duplicate utility functions** | `src/tools/*.ts` | `safeLog`, `createErrorResponse` copied in 4 files | ~60 lines |
| **Scattered configuration** | Multiple files | Tool-specific settings not centralized | Various |

### Current Architecture

```
src/
├── index.ts              # Entry point with repetitive if/else routing
├── tools/
│   ├── definitions.ts    # Hardcoded tool descriptions (167 lines)
│   ├── reddit.ts         # Handler with duplicate error patterns
│   ├── research.ts       # Handler with duplicate error patterns
│   ├── scrape.ts         # Handler with duplicate error patterns
│   └── search.ts         # Handler with duplicate error patterns
├── schemas/
│   ├── deep-research.ts  # Zod schema with inline .describe() (244 lines)
│   ├── scrape-links.ts   # Zod schema with inline .describe()
│   └── web-search.ts     # Zod schema with inline .describe()
├── config/
│   └── index.ts          # Well-organized config (keep this pattern)
├── clients/              # API clients (minimal changes needed)
├── services/             # Business logic services
└── utils/                # Utilities including error handling
```

### Code Duplication Examples

**Handler Pattern (repeated 4x):**
```typescript
// Same pattern in reddit.ts, research.ts, scrape.ts, search.ts
async function safeLog(
  logger: ToolOptions['logger'],
  sessionId: string | undefined,
  level: 'info' | 'error' | 'debug',
  message: string
): Promise<void> {
  if (!logger || !sessionId) return;
  try {
    await logger(level, message, sessionId);
  } catch {
    console.error(`[Tool] Logger failed: ${message}`);
  }
}
```

**Routing Pattern (repeated 5x):**
```typescript
// Same pattern for each tool in index.ts
if (name === 'tool_name') {
  if (!capabilities.capability) {
    return { content: [{ type: 'text', text: getMissingEnvMessage('capability') }], isError: true };
  }
  const validatedParams = schema.parse(args);
  const result = await handler(validatedParams);
  return { content: [{ type: 'text', text: result }] };
}
```

---

## Target Architecture

### Design Principles

1. **Configuration as Code** - YAML defines all tool metadata
2. **DRY (Don't Repeat Yourself)** - Shared utilities for common patterns
3. **Registry Pattern** - Declarative tool registration
4. **Type Safety** - Full TypeScript inference maintained
5. **Backward Compatibility** - Same MCP protocol output

### New Architecture

```
src/
├── index.ts              # Simplified entry (~50 lines, uses registry)
├── config/
│   ├── index.ts          # Exports all config (extended)
│   ├── types.ts          # TypeScript interfaces for YAML config
│   ├── loader.ts         # YAML parser + Zod schema generator
│   └── yaml/
│       └── tools.yaml    # Single source of truth for all tool metadata
├── tools/
│   ├── registry.ts       # Handler registry with executeTool wrapper
│   ├── utils.ts          # Shared utilities (safeLog, error helpers)
│   ├── definitions.ts    # Generated from YAML (~30 lines)
│   ├── reddit.ts         # Handler (uses shared utils)
│   ├── research.ts       # Handler (uses shared utils)
│   ├── scrape.ts         # Handler (uses shared utils)
│   └── search.ts         # Handler (uses shared utils)
├── schemas/
│   ├── index.ts          # Barrel export for all schemas
│   ├── deep-research.ts  # Zod schema (descriptions from YAML)
│   ├── scrape-links.ts   # Zod schema (descriptions from YAML)
│   └── web-search.ts     # Zod schema (descriptions from YAML)
├── clients/              # Unchanged
├── services/             # Unchanged
└── utils/                # Unchanged
docs/
└── refactoring/
    ├── 01-architecture-overview.md (this file)
    ├── 02-yaml-schema-design.md
    ├── 03-handler-registry-design.md
    ├── 04-migration-guide.md
    └── 05-final-summary.md
```

---

## YAML Configuration Design

### Rationale

Moving tool metadata to YAML provides:

1. **Single Source of Truth** - One file defines all tool names, descriptions, parameters
2. **Non-Developer Editable** - Product/docs team can update descriptions without TypeScript knowledge
3. **Validation at Load Time** - Parser validates YAML structure before runtime
4. **Separation of Concerns** - Configuration separate from logic

### YAML Structure Overview

```yaml
# src/config/yaml/tools.yaml
version: "1.0"

tools:
  - name: search_reddit
    category: reddit
    capability: search          # Maps to getCapabilities() key
    description: |
      **Comprehensive Reddit research via Google...**
    
    parameters:
      queries:
        type: array
        items:
          type: string
        required: true
        description: |
          **3-50 queries for Reddit research...**
        validation:
          min: 3
          max: 50
      
      date_after:
        type: string
        required: false
        description: "Filter results after date (YYYY-MM-DD)."
```

### Benefits Over Current Approach

| Aspect | Before | After |
|--------|--------|-------|
| **Tool description location** | definitions.ts (hardcoded) | tools.yaml |
| **Parameter descriptions** | Zod .describe() + definitions.ts | tools.yaml only |
| **Adding new tool** | Edit 3+ files | Edit tools.yaml + add handler |
| **Description updates** | Edit TypeScript, rebuild | Edit YAML, reload |
| **Type safety** | Full | Full (via loader) |

---

## Handler Registry Design

### Rationale

The registry pattern provides:

1. **Declarative Registration** - Tools registered with their capabilities/schemas/handlers
2. **Shared Middleware** - Capability checks, validation, error handling in one place
3. **Reduced Boilerplate** - One `executeTool` function replaces 5 if/else blocks
4. **Type Inference** - Zod schemas provide full parameter typing

### Registry Structure

```typescript
// src/tools/registry.ts
interface ToolRegistration<TParams = unknown> {
  name: string;
  capability?: keyof Capabilities;
  schema: z.ZodSchema<TParams>;
  handler: (params: TParams) => Promise<string>;
}

const registry: Record<string, ToolRegistration> = {
  search_reddit: {
    name: 'search_reddit',
    capability: 'search',
    schema: searchRedditParamsSchema,
    handler: handleSearchReddit,
  },
  // ... other tools
};

export async function executeTool(
  name: string,
  args: unknown,
  capabilities: Capabilities
): Promise<CallToolResult> {
  // 1. Lookup tool
  // 2. Check capability
  // 3. Validate params with Zod
  // 4. Execute handler
  // 5. Format response (success or error)
}
```

### New index.ts Flow

```typescript
// Before: 80+ lines of if/else
// After: ~20 lines
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return executeTool(name, args, capabilities);
});
```

---

## Shared Utilities Design

### Functions to Extract

| Function | Current Location | New Location | Used By |
|----------|-----------------|--------------|---------|
| `safeLog` | 4 handler files | `src/tools/utils.ts` | All handlers |
| `createErrorResponse` | scrape.ts | `src/tools/utils.ts` | All handlers |
| `formatRetryHint` | Inline in handlers | `src/tools/utils.ts` | All handlers |
| `calculateTokenAllocation` | research.ts, scrape.ts | `src/tools/utils.ts` | research, scrape |

### Shared Utils Interface

```typescript
// src/tools/utils.ts
export interface ToolLogger {
  (level: 'info' | 'error' | 'debug', message: string, sessionId: string): Promise<void>;
}

export async function safeLog(
  logger: ToolLogger | undefined,
  sessionId: string | undefined,
  level: 'info' | 'error' | 'debug',
  message: string,
  toolName: string
): Promise<void>;

export function createErrorResponse<T>(
  message: string,
  params: { urls?: string[]; questions?: unknown[] },
  startTime: number
): { content: string; structuredContent: T };

export function calculateTokenAllocation(
  count: number,
  budget: number
): number;
```

---

## Migration Strategy

### Phase 1: Documentation (Tasks 01-03)
- Create architecture docs (this file)
- Create YAML schema design doc
- Create handler registry design doc

### Phase 2: Infrastructure (Tasks 04-05)
- Create `tools.yaml` with all metadata
- Create YAML loader with Zod generation
- Create TypeScript types

### Phase 3: Registry (Task 06)
- Create handler registry
- Create `executeTool` wrapper
- Add shared utilities

### Phase 4: Migration (Tasks 07-10)
- Refactor definitions.ts to use YAML
- Refactor index.ts to use registry
- Update schemas to use YAML descriptions
- Extract shared handler utilities

### Phase 5: Verification (Tasks 11-12)
- Create migration guide
- Verify all tools work
- Final documentation

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| **Breaking existing functionality** | Keep original files until verified; run tests after each change |
| **YAML parsing errors at runtime** | Validate YAML schema at load time; fail fast with clear errors |
| **Type safety loss** | Use Zod for runtime validation; TypeScript for compile-time |
| **Performance regression** | YAML loaded once at startup; no runtime parsing per request |

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Lines in definitions.ts | 167 | <30 |
| Lines in index.ts | 180+ | <60 |
| Duplicate utility functions | 4x | 0 |
| Files to edit for new tool | 3+ | 2 (YAML + handler) |
| Description locations | 2+ per tool | 1 (YAML only) |

---

## Next Steps

1. → **02-yaml-schema-design.md** - Detailed YAML schema specification
2. → **03-handler-registry-design.md** - Registry implementation details
3. → Begin implementation with Task 04 (tools.yaml creation)
