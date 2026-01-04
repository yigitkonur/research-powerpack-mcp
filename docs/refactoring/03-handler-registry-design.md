# Handler Registry Design Specification

> **Version:** 1.0  
> **Date:** January 2026  
> **Related:** [01-architecture-overview.md](./01-architecture-overview.md), [02-yaml-schema-design.md](./02-yaml-schema-design.md)

## Overview

This document specifies the handler registry pattern that replaces the repetitive if/else routing in `index.ts`. The registry provides:

- Declarative tool registration with capabilities and schemas
- Shared middleware for validation, capability checks, and error handling
- Type-safe handler execution with Zod inference
- Reduced boilerplate from ~80 lines to ~15 lines

---

## Current State: Repetitive Routing

### Problem: Duplicated If/Else Blocks

```typescript
// src/index.ts - CURRENT STATE (lines 76-158)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ========== SEARCH_REDDIT ========== (15 lines)
    if (name === 'search_reddit') {
      if (!capabilities.search) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('search') }], isError: true };
      }
      const { queries, date_after } = args as { queries: string[]; date_after?: string };
      if (!Array.isArray(queries) || queries.length === 0) {
        return { content: [{ type: 'text', text: 'Error: queries must be a non-empty array' }], isError: true };
      }
      const result = await handleSearchReddit(queries, env.SEARCH_API_KEY!, date_after);
      return { content: [{ type: 'text', text: result }] };
    }

    // ========== GET_REDDIT_POST ========== (15 lines - same pattern)
    if (name === 'get_reddit_post') { /* ... */ }

    // ========== DEEP_RESEARCH ========== (12 lines - same pattern)
    if (name === 'deep_research') { /* ... */ }

    // ========== SCRAPE_LINKS ========== (15 lines - same pattern)
    if (name === 'scrape_links') { /* ... */ }

    // ========== WEB_SEARCH ========== (12 lines - same pattern)
    if (name === 'web_search') { /* ... */ }

    throw new McpError(McpErrorCode.MethodNotFound, `Method not found: ${name}`);
  } catch (error) {
    // Error handling...
  }
});
```

### Issues

1. **Duplication**: Same pattern repeated 5x (~75 lines)
2. **Inconsistency**: Manual validation in some, Zod in others
3. **Maintenance**: Adding new tool requires editing index.ts
4. **Error Handling**: Duplicated error formatting logic

---

## Target State: Registry Pattern

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CallToolRequestSchema                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    executeTool(name, args)                   │
├─────────────────────────────────────────────────────────────┤
│  1. Lookup tool in registry                                  │
│  2. Check capability (if required)                           │
│  3. Validate params with Zod schema                          │
│  4. Execute handler with typed params                        │
│  5. Format response (success or error)                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Handler  │   │ Handler  │   │ Handler  │
    │ reddit   │   │ research │   │ scrape   │
    └──────────┘   └──────────┘   └──────────┘
```

---

## Type Definitions

### ToolRegistration Interface

```typescript
// src/tools/registry.ts

import { z } from 'zod';
import type { Capabilities } from '../config/index.js';

/**
 * Configuration for a registered tool
 * @template TParams - Inferred parameter type from Zod schema
 */
export interface ToolRegistration<TParams = unknown> {
  /** Unique tool name (must match YAML config) */
  name: string;
  
  /** Required capability key from getCapabilities() */
  capability?: keyof Capabilities;
  
  /** Zod schema for parameter validation */
  schema: z.ZodSchema<TParams>;
  
  /** 
   * Handler function that receives validated params
   * Must return markdown string (never throws - returns error in string)
   */
  handler: (params: TParams) => Promise<string>;
  
  /**
   * Optional post-validation hook for custom checks
   * Return error message string if validation fails, undefined if OK
   */
  postValidate?: (params: TParams) => string | undefined;
  
  /**
   * Optional response transformer
   * Used for tools that need structured metadata (e.g., scrape_links)
   */
  transformResponse?: (result: string) => { content: string; isError?: boolean };
}

/**
 * Registry type - maps tool names to their configurations
 */
export type ToolRegistry = Record<string, ToolRegistration<unknown>>;
```

### CallToolResult Type

```typescript
// MCP SDK compatible response type
interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
```

---

## Registry Implementation

### Tool Registry Definition

```typescript
// src/tools/registry.ts

import { z } from 'zod';
import { searchRedditParamsSchema } from '../schemas/reddit.js';
import { getRedditPostParamsSchema } from '../schemas/reddit.js';
import { deepResearchParamsSchema } from '../schemas/deep-research.js';
import { scrapeLinksParamsSchema } from '../schemas/scrape-links.js';
import { webSearchParamsSchema } from '../schemas/web-search.js';

import { handleSearchReddit, handleGetRedditPosts } from './reddit.js';
import { handleDeepResearch } from './research.js';
import { handleScrapeLinks } from './scrape.js';
import { handleWebSearch } from './search.js';

import { parseEnv } from '../config/index.js';

const env = parseEnv();

/**
 * Central registry of all MCP tools
 * Single source of truth for tool → handler mapping
 */
export const toolRegistry: ToolRegistry = {
  search_reddit: {
    name: 'search_reddit',
    capability: 'search',
    schema: searchRedditParamsSchema,
    handler: async (params) => {
      const { queries, date_after } = params;
      return handleSearchReddit(queries, env.SEARCH_API_KEY!, date_after);
    },
  },

  get_reddit_post: {
    name: 'get_reddit_post',
    capability: 'reddit',
    schema: getRedditPostParamsSchema,
    handler: async (params) => {
      const { urls, max_comments, fetch_comments } = params;
      return handleGetRedditPosts(
        urls,
        env.REDDIT_CLIENT_ID!,
        env.REDDIT_CLIENT_SECRET!,
        max_comments,
        { fetchComments: fetch_comments }
      );
    },
  },

  deep_research: {
    name: 'deep_research',
    capability: 'deepResearch',
    schema: deepResearchParamsSchema,
    handler: async (params) => {
      const { content } = await handleDeepResearch(params);
      return content;
    },
    transformResponse: (result) => {
      // Check if result indicates error
      const isError = result.includes('# ❌ Error');
      return { content: result, isError };
    },
  },

  scrape_links: {
    name: 'scrape_links',
    capability: 'scraping',
    schema: scrapeLinksParamsSchema,
    handler: async (params) => {
      const { content, structuredContent } = await handleScrapeLinks(params);
      // Return content; error detection via transformResponse
      return content;
    },
    transformResponse: (result) => {
      const isError = result.includes('# ❌ Scraping Failed');
      return { content: result, isError };
    },
  },

  web_search: {
    name: 'web_search',
    capability: 'search',
    schema: webSearchParamsSchema,
    handler: async (params) => {
      const { content } = await handleWebSearch(params);
      return content;
    },
    transformResponse: (result) => {
      const isError = result.includes('# ❌ web_search');
      return { content: result, isError };
    },
  },
};
```

---

## executeTool Wrapper

### Implementation

```typescript
// src/tools/registry.ts

import { McpError, ErrorCode as McpErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { classifyError, createToolErrorFromStructured } from '../utils/errors.js';
import { getMissingEnvMessage, type Capabilities } from '../config/index.js';

/**
 * Execute a tool by name with full middleware chain
 * 
 * Middleware steps:
 * 1. Lookup tool in registry (throw McpError if not found)
 * 2. Check capability (return error response if missing)
 * 3. Validate params with Zod (return error response if invalid)
 * 4. Execute handler (catch and format any errors)
 * 5. Transform response if needed
 * 
 * @param name - Tool name from request
 * @param args - Raw arguments from request
 * @param capabilities - Current capabilities from getCapabilities()
 * @returns MCP-compliant tool result
 */
export async function executeTool(
  name: string,
  args: unknown,
  capabilities: Capabilities
): Promise<CallToolResult> {
  // Step 1: Lookup tool
  const tool = toolRegistry[name];
  if (!tool) {
    throw new McpError(
      McpErrorCode.MethodNotFound,
      `Method not found: ${name}. Available tools: ${Object.keys(toolRegistry).join(', ')}`
    );
  }

  // Step 2: Check capability
  if (tool.capability && !capabilities[tool.capability]) {
    return {
      content: [{ type: 'text', text: getMissingEnvMessage(tool.capability) }],
      isError: true,
    };
  }

  // Step 3: Validate params with Zod
  let validatedParams: unknown;
  try {
    validatedParams = tool.schema.parse(args);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(i => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      return {
        content: [{ type: 'text', text: `# ❌ Validation Error\n\n${issues}` }],
        isError: true,
      };
    }
    // Non-Zod validation error
    const structured = classifyError(error);
    return createToolErrorFromStructured(structured);
  }

  // Step 3.5: Optional post-validation
  if (tool.postValidate) {
    const postError = tool.postValidate(validatedParams);
    if (postError) {
      return {
        content: [{ type: 'text', text: `# ❌ Validation Error\n\n${postError}` }],
        isError: true,
      };
    }
  }

  // Step 4: Execute handler
  let result: string;
  try {
    result = await tool.handler(validatedParams);
  } catch (error) {
    // Handler threw (shouldn't happen if handlers follow "never throw" pattern)
    const structured = classifyError(error);
    return createToolErrorFromStructured(structured);
  }

  // Step 5: Transform response
  if (tool.transformResponse) {
    const transformed = tool.transformResponse(result);
    return {
      content: [{ type: 'text', text: transformed.content }],
      isError: transformed.isError,
    };
  }

  // Default: success response
  return {
    content: [{ type: 'text', text: result }],
  };
}
```

---

## Refactored index.ts

### Before (80+ lines)

```typescript
// 5 if/else blocks, each 12-15 lines
if (name === 'search_reddit') { /* 15 lines */ }
if (name === 'get_reddit_post') { /* 15 lines */ }
if (name === 'deep_research') { /* 12 lines */ }
if (name === 'scrape_links') { /* 15 lines */ }
if (name === 'web_search') { /* 12 lines */ }
throw new McpError(...);
```

### After (~15 lines)

```typescript
// src/index.ts - REFACTORED

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools/definitions.js';
import { executeTool } from './tools/registry.js';
import { getCapabilities, SERVER } from './config/index.js';
import { classifyError, createToolErrorFromStructured } from './utils/errors.js';

const capabilities = getCapabilities();

const server = new Server(
  { name: SERVER.NAME, version: SERVER.VERSION },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Execute tool - ALL routing handled by registry
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    return await executeTool(name, args, capabilities);
  } catch (error) {
    // McpError propagates to client as protocol error
    if (error instanceof McpError) {
      throw error;
    }
    // Unexpected error - format as tool error
    const structured = classifyError(error);
    return createToolErrorFromStructured(structured);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Type Safety Approach

### Zod Inference

```typescript
// Each handler receives correctly typed params
const tool: ToolRegistration<z.infer<typeof scrapeLinksParamsSchema>> = {
  schema: scrapeLinksParamsSchema,
  handler: async (params) => {
    // params is fully typed:
    // {
    //   urls: string[];
    //   timeout?: number;
    //   use_llm?: boolean;
    //   what_to_extract?: string;
    // }
    const { urls, timeout } = params;  // ✓ TypeScript knows these
    return handleScrapeLinks(params);
  },
};
```

### Registry Type Constraints

```typescript
// Compile-time check that all tools have valid schemas
const registry = {
  tool_name: {
    schema: someZodSchema,
    handler: async (params: z.infer<typeof someZodSchema>) => {
      // Type mismatch caught at compile time
    },
  },
} satisfies ToolRegistry;
```

---

## Adding New Tools

### Step-by-Step Guide

1. **Add to tools.yaml** (Task 04):
   ```yaml
   - name: new_tool
     capability: search
     description: |
       Tool description...
     parameters:
       param1:
         type: string
         required: true
   ```

2. **Create Zod schema** (or use YAML-generated):
   ```typescript
   // src/schemas/new-tool.ts
   export const newToolParamsSchema = z.object({
     param1: z.string(),
   });
   ```

3. **Create handler**:
   ```typescript
   // src/tools/new-tool.ts
   export async function handleNewTool(params: NewToolParams): Promise<string> {
     // Implementation
     return `# Result\n\n...`;
   }
   ```

4. **Register in registry**:
   ```typescript
   // src/tools/registry.ts
   new_tool: {
     name: 'new_tool',
     capability: 'search',
     schema: newToolParamsSchema,
     handler: async (params) => handleNewTool(params),
   },
   ```

**Total: 4 files touched** (down from 6+ in current approach)

---

## Shared Utilities

### Utilities to Extract

```typescript
// src/tools/utils.ts

/**
 * Shared logger wrapper - NEVER throws
 */
export async function safeLog(
  logger: ToolLogger | undefined,
  sessionId: string | undefined,
  level: 'info' | 'error' | 'debug',
  message: string,
  toolName: string
): Promise<void> {
  if (!logger || !sessionId) return;
  try {
    await logger(level, `[${toolName}] ${message}`, sessionId);
  } catch {
    console.error(`[${toolName}] Logger failed: ${message}`);
  }
}

/**
 * Calculate token allocation for batch operations
 */
export function calculateTokenAllocation(count: number, budget: number): number {
  if (count <= 0) return budget;
  return Math.floor(budget / count);
}

/**
 * Format retry hint based on error
 */
export function formatRetryHint(retryable: boolean): string {
  return retryable ? '\n\n💡 This error may be temporary. Try again in a moment.' : '';
}
```

---

## Migration Checklist

| Step | File | Action | Lines Changed |
|------|------|--------|---------------|
| 1 | `src/tools/registry.ts` | Create new file with registry + executeTool | +150 |
| 2 | `src/tools/utils.ts` | Create shared utilities | +50 |
| 3 | `src/index.ts` | Replace if/else with executeTool | -80, +15 |
| 4 | `src/tools/reddit.ts` | Use shared safeLog | -15, +2 |
| 5 | `src/tools/research.ts` | Use shared safeLog, calculateTokenAllocation | -20, +3 |
| 6 | `src/tools/scrape.ts` | Use shared utilities | -25, +3 |
| 7 | `src/tools/search.ts` | Use shared utilities | -15, +2 |

**Net result**: ~200 lines removed, ~225 lines added (but organized and reusable)

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────────┐
│                       executeTool()                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Tool not found ─────────────► throw McpError.MethodNotFound │
│                                (protocol error to client)    │
│                                                              │
│  Capability missing ─────────► return { isError: true }      │
│                                (tool error with message)     │
│                                                              │
│  Zod validation fails ───────► return { isError: true }      │
│                                (formatted validation errors) │
│                                                              │
│  Handler throws ─────────────► classifyError() + format      │
│                                (should not happen)           │
│                                                              │
│  Handler returns error ──────► transformResponse detects     │
│                                (e.g., "# ❌" in result)      │
│                                                              │
│  Success ────────────────────► return { content: result }    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests

```typescript
// tests/registry.test.ts
describe('executeTool', () => {
  it('returns MethodNotFound for unknown tool', async () => {
    await expect(executeTool('unknown', {}, capabilities))
      .rejects.toThrow(McpError);
  });

  it('returns capability error when missing', async () => {
    const result = await executeTool('deep_research', {}, { ...capabilities, deepResearch: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OPENROUTER_API_KEY');
  });

  it('returns validation error for invalid params', async () => {
    const result = await executeTool('search_reddit', { queries: [] }, capabilities);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation Error');
  });

  it('executes handler with valid params', async () => {
    const result = await executeTool('web_search', { keywords: ['test'] }, capabilities);
    expect(result.isError).toBeFalsy();
  });
});
```

---

## Next Steps

1. → **Task 04** - Create tools.yaml with all tool definitions
2. → **Task 05** - Create YAML loader
3. → **Task 06** - Implement this registry design
