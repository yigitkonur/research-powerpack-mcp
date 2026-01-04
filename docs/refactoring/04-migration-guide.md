# Migration Guide

> **Version:** 1.0  
> **Date:** January 2026  
> **Audience:** Developers adding or modifying tools

## Overview

This guide covers:
1. Before/after code comparison
2. How to add new tools
3. YAML schema reference
4. Troubleshooting

---

## Before/After Comparison

### definitions.ts

**Before (167 lines):**
```typescript
export const TOOLS = [
  {
    name: 'search_reddit',
    description: `**Comprehensive Reddit research...**
    
    // 50+ lines of hardcoded markdown
    `,
    inputSchema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          description: `**3-50 queries...**  // 20+ lines duplicated
          `,
        },
        // ... more properties
      },
    },
  },
  // ... 4 more tools, each 30-50 lines
];
```

**After (19 lines):**
```typescript
import { generateMcpTools } from '../config/loader.js';

/**
 * TOOLS array is now loaded from src/config/yaml/tools.yaml
 * Single source of truth for all tool metadata
 */
export const TOOLS = generateMcpTools();
```

### index.ts

**Before (263 lines):**
```typescript
// 10+ imports
import { handleSearchReddit, handleGetRedditPosts } from './tools/reddit.js';
import { handleDeepResearch } from './tools/research.js';
// ...

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // 80+ lines of if/else blocks
  if (name === 'search_reddit') {
    if (!capabilities.search) { return error; }
    const { queries } = args as { queries: string[] };
    if (!Array.isArray(queries)) { return error; }
    const result = await handleSearchReddit(queries, ...);
    return { content: [{ type: 'text', text: result }] };
  }
  
  if (name === 'get_reddit_post') { /* same pattern */ }
  if (name === 'deep_research') { /* same pattern */ }
  if (name === 'scrape_links') { /* same pattern */ }
  if (name === 'web_search') { /* same pattern */ }
  
  throw new McpError(...);
});
```

**After (143 lines):**
```typescript
// 4 imports
import { TOOLS } from './tools/definitions.js';
import { executeTool, getToolCapabilities } from './tools/registry.js';
// ...

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    // All routing handled by registry!
    return await executeTool(name, args, capabilities);
  } catch (error) {
    // Simplified error handling
  }
});
```

### Summary

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `definitions.ts` | 167 lines | 19 lines | **-88%** |
| `index.ts` | 263 lines | 143 lines | **-46%** |
| **Total** | 430 lines | 162 lines | **-62%** |

---

## How to Add New Tools

### Step 1: Add to tools.yaml

```yaml
# src/config/yaml/tools.yaml

tools:
  # ... existing tools ...
  
  - name: my_new_tool
    category: custom
    capability: search  # Must match key in Capabilities interface
    description: |
      **My New Tool Description**
      
      Markdown description that guides LLM usage.
      Include:
      - What the tool does
      - When to use it
      - Parameter explanations
      - Example use cases
    
    # Option A: Inline parameters (simple tools)
    parameters:
      input_text:
        type: string
        required: true
        description: "The input text to process"
        validation:
          minLength: 1
          maxLength: 5000
      
      options:
        type: object
        required: false
        properties:
          format:
            type: string
            required: false
            description: "Output format (json, markdown, text)"
    
    # Option B: Use existing Zod schema (complex tools)
    # useZodSchema: true
    # zodSchemaRef: "myNewToolParamsSchema"
```

### Step 2: Create Handler

```typescript
// src/tools/my-new-tool.ts

import { safeLog, type ToolOptions } from './utils.js';
import { classifyError } from '../utils/errors.js';

interface MyNewToolParams {
  input_text: string;
  options?: {
    format?: string;
  };
}

export async function handleMyNewTool(
  params: MyNewToolParams,
  options: ToolOptions = {}
): Promise<string> {
  const { sessionId, logger } = options;
  
  try {
    await safeLog(logger, sessionId, 'info', `Processing input: ${params.input_text.length} chars`, 'my_new_tool');
    
    // Your implementation here
    const result = processInput(params.input_text, params.options);
    
    return `# Results\n\n${result}`;
  } catch (error) {
    const err = classifyError(error);
    return `# ❌ my_new_tool: Error\n\n**${err.code}:** ${err.message}`;
  }
}
```

### Step 3: Create Zod Schema (if using useZodSchema)

```typescript
// src/schemas/my-new-tool.ts

import { z } from 'zod';

export const myNewToolParamsSchema = z.object({
  input_text: z.string().min(1).max(5000),
  options: z.object({
    format: z.enum(['json', 'markdown', 'text']).optional(),
  }).optional(),
});

export type MyNewToolParams = z.infer<typeof myNewToolParamsSchema>;
```

### Step 4: Register in Registry

```typescript
// src/tools/registry.ts

import { myNewToolParamsSchema } from '../schemas/my-new-tool.js';
import { handleMyNewTool } from './my-new-tool.js';

export const toolRegistry: ToolRegistry = {
  // ... existing tools ...
  
  my_new_tool: {
    name: 'my_new_tool',
    capability: 'search',  // or appropriate capability
    schema: myNewToolParamsSchema,
    handler: async (params) => handleMyNewTool(params),
    // Optional: detect errors in response
    transformResponse: (result) => ({
      content: result,
      isError: result.includes('# ❌'),
    }),
  },
};
```

### Step 5: Add Schema to Loader (if using useZodSchema)

```typescript
// src/config/loader.ts

import { myNewToolParamsSchema } from '../schemas/my-new-tool.js';

const zodSchemaRegistry: Record<string, z.ZodTypeAny> = {
  // ... existing schemas ...
  myNewToolParamsSchema,
};
```

### Step 6: Test

```bash
# Run TypeScript check
npm run typecheck

# Build
npm run build

# Test with MCP client
npm run dev
```

---

## YAML Schema Reference

### Tool Definition

```yaml
- name: string              # Required: Unique identifier
  category: string          # Optional: Grouping (reddit, research, etc.)
  capability: string        # Optional: Maps to Capabilities key
  description: |            # Required: Markdown description
    **Tool description**
  
  # For simple tools with inline parameters
  parameters:
    param_name:
      type: string|number|boolean|array|object
      required: boolean
      default: any
      description: string
      validation: ValidationRules
      items: Parameter          # For array type
      properties: Parameters    # For object type
  
  # For complex tools using existing Zod schemas
  useZodSchema: true
  zodSchemaRef: string          # Name in zodSchemaRegistry
  schemaDescriptions:           # Description overrides
    fieldPath: string
```

### Validation Rules

| Type | Rules |
|------|-------|
| **string** | `minLength`, `maxLength`, `pattern`, `format` (uri/email/uuid) |
| **number** | `min`, `max`, `int`, `positive`, `negative` |
| **array** | `minItems`, `maxItems`, `nonempty` |

### Capability Keys

```typescript
interface Capabilities {
  reddit: boolean;        // REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
  search: boolean;        // SERPER_API_KEY
  scraping: boolean;      // SCRAPEDO_API_KEY
  deepResearch: boolean;  // OPENROUTER_API_KEY
  llmExtraction: boolean; // OPENROUTER_API_KEY
}
```

---

## Troubleshooting

### "Method not found" Error

**Cause:** Tool not registered in registry or name mismatch.

**Fix:**
1. Check `tools.yaml` has the tool defined
2. Check `registry.ts` has the tool registered
3. Verify names match exactly (case-sensitive)

### Validation Errors

**Cause:** Zod schema doesn't match YAML parameters.

**Fix:**
1. If using `useZodSchema: true`, ensure `zodSchemaRef` matches registry key
2. If using inline parameters, check validation rules match Zod equivalents
3. Run `npm run typecheck` to catch type mismatches

### Tool Not Showing in ListTools

**Cause:** YAML parsing error or loader issue.

**Fix:**
1. Validate YAML syntax (use online YAML validator)
2. Check `generateMcpTools()` logs for errors
3. Ensure `yaml` package is installed: `npm install yaml`

### Capability Check Failing

**Cause:** Missing environment variable.

**Fix:**
1. Check `.env` has required keys
2. Verify `capability` field in YAML matches `Capabilities` interface key
3. Check `getCapabilities()` output at startup

### Handler Not Executing

**Cause:** Registry lookup failing or handler throwing.

**Fix:**
1. Add console.log in `executeTool` to trace flow
2. Check handler follows "never throw" pattern
3. Verify handler is exported from correct path

---

## File Reference

### New Files Created

| File | Purpose |
|------|---------|
| `src/config/yaml/tools.yaml` | Tool definitions (single source of truth) |
| `src/config/types.ts` | TypeScript interfaces for YAML |
| `src/config/loader.ts` | YAML parser and Zod generator |
| `src/tools/registry.ts` | Handler registry and executeTool |
| `src/tools/utils.ts` | Shared utility functions |

### Modified Files

| File | Changes |
|------|---------|
| `src/tools/definitions.ts` | Now imports from loader |
| `src/index.ts` | Uses executeTool instead of if/else |
| `package.json` | Added `yaml` dependency |

### Documentation

| File | Content |
|------|---------|
| `docs/refactoring/01-architecture-overview.md` | High-level design |
| `docs/refactoring/02-yaml-schema-design.md` | YAML specification |
| `docs/refactoring/03-handler-registry-design.md` | Registry pattern |
| `docs/refactoring/04-migration-guide.md` | This file |

---

## Next Steps

After adding a new tool:

1. **Test locally:** `npm run dev`
2. **Run type check:** `npm run typecheck`
3. **Build:** `npm run build`
4. **Update README** if tool is user-facing
5. **Add tests** in `tests/` directory
