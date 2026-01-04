# YAML Schema Design Specification

> **Version:** 1.0  
> **Date:** January 2026  
> **Related:** [01-architecture-overview.md](./01-architecture-overview.md)

## Overview

This document specifies the YAML schema structure for defining MCP tools. The schema enables:

- Centralized tool metadata (names, descriptions, parameters)
- Declarative Zod validation rules
- Automatic JSON Schema generation for MCP protocol
- Type-safe TypeScript interfaces

---

## Schema Structure

### Root Level

```yaml
# src/config/yaml/tools.yaml
version: "1.0"
metadata:
  name: "research-powerpack-mcp"
  description: "Research tools for AI assistants"

tools:
  - name: tool_name
    # ... tool definition
```

### Tool Definition

```yaml
tools:
  - name: string                    # Required: Unique tool identifier
    category: string                # Optional: Grouping (reddit, research, scrape, search)
    capability: string              # Optional: Maps to getCapabilities() key
    description: |                  # Required: Markdown description for LLM
      **Tool description...**
    
    parameters:                     # Required: Parameter definitions
      param_name:
        type: string                # Required: string | number | boolean | array | object
        # ... parameter options
```

---

## Parameter Types

### String Parameters

```yaml
date_after:
  type: string
  required: false
  default: null
  description: "Filter results after date (YYYY-MM-DD). Optional."
  validation:
    minLength: 10        # Maps to z.string().min(10)
    maxLength: 10        # Maps to z.string().max(10)
    pattern: "^\\d{4}-\\d{2}-\\d{2}$"  # Maps to z.string().regex()
```

**Zod Output:**
```typescript
z.string()
  .min(10)
  .max(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Filter results after date...")
```

### Number Parameters

```yaml
timeout:
  type: number
  required: false
  default: 30
  description: "Timeout in seconds for each URL"
  validation:
    min: 5               # Maps to z.number().min(5)
    max: 120             # Maps to z.number().max(120)
    int: true            # Maps to z.number().int()
```

**Zod Output:**
```typescript
z.number()
  .int()
  .min(5)
  .max(120)
  .default(30)
  .describe("Timeout in seconds...")
```

### Boolean Parameters

```yaml
use_llm:
  type: boolean
  required: false
  default: false
  description: "Enable AI processing for content extraction"
```

**Zod Output:**
```typescript
z.boolean()
  .default(false)
  .describe("Enable AI processing...")
```

### Array Parameters

```yaml
urls:
  type: array
  required: true
  description: "URLs to scrape (1-50)..."
  items:
    type: string
    validation:
      format: uri        # Maps to z.string().url()
  validation:
    minItems: 1          # Maps to z.array().min(1)
    maxItems: 50         # Maps to z.array().max(50)
```

**Zod Output:**
```typescript
z.array(
  z.string().url()
)
  .min(1)
  .max(50)
  .describe("URLs to scrape...")
```

### Object Parameters (Nested)

```yaml
file_attachments:
  type: array
  required: false
  description: "File attachments to include..."
  items:
    type: object
    properties:
      path:
        type: string
        required: true
        description: "**[REQUIRED] Absolute file path to attach.**..."
        validation:
          minLength: 1
      start_line:
        type: number
        required: false
        description: "**[OPTIONAL] Start line number (1-indexed).**..."
        validation:
          int: true
          positive: true
      end_line:
        type: number
        required: false
        description: "**[OPTIONAL] End line number (1-indexed).**..."
        validation:
          int: true
          positive: true
      description:
        type: string
        required: false
        description: "**[HIGHLY RECOMMENDED] Description of why this file is attached...**"
```

**Zod Output:**
```typescript
z.array(
  z.object({
    path: z.string().min(1).describe("..."),
    start_line: z.number().int().positive().optional().describe("..."),
    end_line: z.number().int().positive().optional().describe("..."),
    description: z.string().optional().describe("..."),
  })
).optional().describe("File attachments...")
```

---

## Validation Rules Reference

### String Validations

| YAML Key | Zod Method | Example |
|----------|------------|---------|
| `minLength` | `.min(n)` | `minLength: 10` |
| `maxLength` | `.max(n)` | `maxLength: 500` |
| `pattern` | `.regex()` | `pattern: "^\\d+$"` |
| `format: uri` | `.url()` | URL validation |
| `format: email` | `.email()` | Email validation |
| `format: uuid` | `.uuid()` | UUID validation |

### Number Validations

| YAML Key | Zod Method | Example |
|----------|------------|---------|
| `min` | `.min(n)` | `min: 1` |
| `max` | `.max(n)` | `max: 100` |
| `int` | `.int()` | `int: true` |
| `positive` | `.positive()` | `positive: true` |
| `negative` | `.negative()` | `negative: true` |

### Array Validations

| YAML Key | Zod Method | Example |
|----------|------------|---------|
| `minItems` | `.min(n)` | `minItems: 1` |
| `maxItems` | `.max(n)` | `maxItems: 50` |
| `nonempty` | `.nonempty()` | `nonempty: true` |

### Common Options

| YAML Key | Zod Method | Description |
|----------|------------|-------------|
| `required: false` | `.optional()` | Makes field optional |
| `default: value` | `.default(value)` | Sets default value |
| `nullable: true` | `.nullable()` | Allows null |

---

## Complete Tool Examples

### search_reddit (Simple Tool)

**Current Code (definitions.ts lines 13-68):**
```typescript
{
  name: 'search_reddit',
  description: `**Comprehensive Reddit research via Google...** (50+ lines)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: `**3-50 queries for Reddit research...** (20+ lines)`,
      },
      date_after: {
        type: 'string',
        description: 'Filter results after date (YYYY-MM-DD). Optional.',
      },
    },
    required: ['queries'],
  },
}
```

**New YAML:**
```yaml
- name: search_reddit
  category: reddit
  capability: search
  description: |
    **Comprehensive Reddit research via Google (10 results/query, 10-50 queries supported).**

    MUST call get_reddit_post after to fetch full post content and comments.

    **QUERY REQUIREMENTS:**
    - **Minimum:** 3 queries (hard limit)
    - **Recommended:** 10+ queries (for meaningful consensus analysis)
    - **Optimal:** 20-30 queries covering all angles of the topic
    - **Maximum:** 50 queries (for comprehensive deep research)

    **OUTPUT FORMAT:**
    1. **High-Consensus Posts** - Posts appearing in multiple queries (ranked by CTR score)
    2. **All Results (CTR-Ranked)** - Aggregated unique posts sorted by weighted score
    3. **Per-Query Raw Results** - Complete results for each individual query before aggregation

    **QUERY CRAFTING STRATEGY (aim for 10-50 distinct queries):**
    - Direct topic variations (3-5 queries)
    - Recommendation/best-of queries (3-5 queries)
    - Specific tool/project names (5-10 queries)
    - Comparison queries (3-5 queries)
    - Alternative/replacement queries (3-5 queries)
    - Subreddit-specific queries (5-10 queries)
    - Problem/issue queries (3-5 queries)
    - Year-specific queries for recency (2-3 queries)

    **OPERATORS:** intitle:, "exact phrase", OR, -exclude. Auto-adds site:reddit.com.

  parameters:
    queries:
      type: array
      required: true
      items:
        type: string
      validation:
        minItems: 3
        maxItems: 50
      description: |
        **3-50 queries for Reddit research.** Minimum 3 required, but generate at least 10 for meaningful consensus. More queries = better consensus detection.

        **QUERY CATEGORIES (aim for coverage across all):**

        1. **Direct Topic (3-5):** "YouTube Music Mac app", "YTM desktop application"
        2. **Recommendations (3-5):** "best YouTube Music client Mac", "recommended YTM app"
        3. **Specific Tools (5-10):** "YTMDesktop Mac", "th-ch youtube-music", "steve228uk YT Music"
        4. **Comparisons (3-5):** "YouTube Music vs Spotify Mac", "YTM vs Apple Music desktop"
        5. **Alternatives (3-5):** "YouTube Music Mac alternative", "YTM replacement app"
        6. **Subreddits (5-10):** "r/YoutubeMusic desktop", "r/macapps YouTube Music", "r/opensource YTM"
        7. **Problems/Issues (3-5):** "YouTube Music desktop performance", "YTM app crashes Mac"
        8. **Year-Specific (2-3):** "best YouTube Music app 2024", "YTM desktop 2025"
        9. **Features (3-5):** "YouTube Music offline Mac", "YTM lyrics desktop"
        10. **Developer/GitHub (3-5):** "youtube-music electron app", "YTM github project"

    date_after:
      type: string
      required: false
      description: "Filter results after date (YYYY-MM-DD). Optional."
```

### get_reddit_post (Medium Complexity)

```yaml
- name: get_reddit_post
  category: reddit
  capability: reddit
  description: |
    **Fetch Reddit posts with smart comment allocation (2-50 posts supported).**

    **SMART COMMENT BUDGET:** 1,000 comments distributed across all posts automatically.
    - 2 posts: ~500 comments/post (deep dive)
    - 10 posts: 100 comments/post
    - 50 posts: 20 comments/post (quick scan)

    **PARAMETERS:**
    - `urls`: 2-50 Reddit post URLs. More posts = broader community perspective.
    - `fetch_comments`: Set to false for post-only queries (faster). Default: true.
    - `max_comments`: Override auto-allocation if needed.

    **USE:** After search_reddit. Maximize post count for research breadth. Comment allocation is automatic and optimized.

  parameters:
    urls:
      type: array
      required: true
      items:
        type: string
      validation:
        minItems: 2
        maxItems: 50
      description: "Reddit URLs (2-50). More posts = broader community perspective."

    fetch_comments:
      type: boolean
      required: false
      default: true
      description: "Fetch comments? Set false for quick post overview. Default: true"

    max_comments:
      type: number
      required: false
      default: 100
      description: "Override auto-allocation. Leave empty for smart allocation."
```

### deep_research (Complex Nested Schema)

```yaml
- name: deep_research
  category: research
  capability: deepResearch
  useZodSchema: true  # Flag to use existing Zod schema (descriptions only from YAML)
  zodSchemaRef: "deepResearchParamsSchema"
  description: |
    **Batch deep research (2-10 questions) with dynamic token allocation.**

    **TOKEN BUDGET:** 32,000 tokens distributed across all questions:
    - 2 questions: 16,000 tokens/question (deep dive)
    - 5 questions: 6,400 tokens/question (balanced)
    - 10 questions: 3,200 tokens/question (rapid multi-topic)

    **WHEN TO USE:**
    - Need multi-perspective analysis on related topics
    - Researching a domain from multiple angles
    - Validating understanding across different aspects
    - Comparing approaches/technologies side-by-side

    **EACH QUESTION SHOULD INCLUDE:**
    - Topic & context (what decision it informs)
    - Your current understanding (to fill gaps)
    - Specific sub-questions (2-5 per topic)

    **USE:** Maximize question count for comprehensive coverage. All questions run in parallel. Group related questions for coherent research.

  # For complex schemas, reference existing Zod schema and inject descriptions
  schemaDescriptions:
    questions: |
      **Batch deep research (2-10 questions) with dynamic token allocation.**
      ... (full description from current schema)
    
    "questions.*.question": |
      **[REQUIRED] Your research question - MUST follow this structured template:**
      ... (full template from current schema)
    
    "questions.*.file_attachments": |
      **[CRITICAL FOR BUGS/CODE QUESTIONS] File attachments to include as research context.**
      ... (full description from current schema)
    
    "questions.*.file_attachments.*.path": |
      **[REQUIRED] Absolute file path to attach.**
      ... (full description)
    
    "questions.*.file_attachments.*.start_line": |
      **[OPTIONAL] Start line number (1-indexed).**
      ...
    
    "questions.*.file_attachments.*.end_line": |
      **[OPTIONAL] End line number (1-indexed).**
      ...
    
    "questions.*.file_attachments.*.description": |
      **[HIGHLY RECOMMENDED] Comprehensive description...**
      ...
```

### scrape_links

```yaml
- name: scrape_links
  category: scrape
  capability: scraping
  useZodSchema: true
  zodSchemaRef: "scrapeLinksParamsSchema"
  description: |
    **Universal URL content extraction (3-50 URLs) with dynamic token allocation.**

    **TOKEN ALLOCATION:** 32,000 tokens distributed across all URLs automatically.
    - 3 URLs: ~10,666 tokens/URL (deep extraction)
    - 10 URLs: 3,200 tokens/URL (detailed)
    - 50 URLs: 640 tokens/URL (high-level scan)

    **AUTOMATIC FALLBACK:** Basic → JavaScript → JavaScript+US geo-targeting.

    **AI EXTRACTION:** Set use_llm=true with what_to_extract for intelligent filtering. Extraction is concise + comprehensive (high info density).

    **BATCHING:** Max 30 concurrent requests. 50 URLs = [30] then [20] batches.

    **USE:** Provide 3-50 URLs. More URLs = broader coverage, fewer tokens per URL. Choose based on research scope. Maximize URL count for comprehensive research.

  schemaDescriptions:
    urls: "URLs to scrape (1-50). Recommend 3-5 URLs for balanced depth/breadth..."
    timeout: "Timeout in seconds for each URL"
    use_llm: "Enable AI processing for content extraction (requires OPENROUTER_API_KEY)"
    what_to_extract: "Specific content extraction instructions for AI..."
```

### web_search

```yaml
- name: web_search
  category: search
  capability: search
  useZodSchema: true
  zodSchemaRef: "webSearchParamsSchema"
  description: |
    **Batch web search** using Google via SERPER API. Search up to 100 keywords in parallel, get top 10 results per keyword with snippets, links, and related searches.

    **FEATURES:**
    - Supports Google search operators (site:, -exclusion, "exact phrase", filetype:)
    - Returns clickable markdown links with snippets
    - Provides related search suggestions
    - Identifies frequently appearing URLs across queries

    **USE:** For research tasks requiring multiple perspectives. Use distinct keywords to maximize coverage. Follow up with scrape_links to extract full content from promising URLs.

  schemaDescriptions:
    keywords: "Array of search keywords (1-100 keywords). Recommend 3-7 keywords..."
```

---

## Loader Implementation Strategy

### Two Approaches

**Approach 1: Full YAML Definition (Simple Tools)**
- YAML defines entire schema including validation rules
- Loader generates Zod schema from YAML
- Used for: `search_reddit`, `get_reddit_post`

**Approach 2: Hybrid (Complex Schemas)**
- YAML defines tool metadata and description overrides
- Existing Zod schemas used for validation
- Descriptions injected from YAML
- Used for: `deep_research`, `scrape_links`, `web_search`

### Loader Pseudocode

```typescript
interface YamlToolConfig {
  name: string;
  category?: string;
  capability?: keyof Capabilities;
  description: string;
  useZodSchema?: boolean;
  zodSchemaRef?: string;
  parameters?: Record<string, YamlParameterConfig>;
  schemaDescriptions?: Record<string, string>;
}

function loadToolsFromYaml(): Tool[] {
  const yaml = fs.readFileSync('src/config/yaml/tools.yaml', 'utf8');
  const config = parse(yaml) as { tools: YamlToolConfig[] };
  
  return config.tools.map(tool => {
    if (tool.useZodSchema && tool.zodSchemaRef) {
      // Hybrid: Use existing Zod schema, inject descriptions
      const schema = getZodSchemaByRef(tool.zodSchemaRef);
      const enrichedSchema = injectDescriptions(schema, tool.schemaDescriptions);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(enrichedSchema),
      };
    } else {
      // Full YAML: Generate Zod from YAML definition
      const schema = yamlToZod(tool.parameters);
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(schema),
      };
    }
  });
}
```

---

## Migration Checklist

| Tool | Current Lines | YAML Approach | Migration Effort |
|------|--------------|---------------|-----------------|
| `search_reddit` | ~55 | Full YAML | Low |
| `get_reddit_post` | ~35 | Full YAML | Low |
| `deep_research` | ~20 + 244 schema | Hybrid | Medium |
| `scrape_links` | ~20 + 56 schema | Hybrid | Low |
| `web_search` | ~15 + 43 schema | Hybrid | Low |

---

## Next Steps

1. → **03-handler-registry-design.md** - Registry pattern implementation
2. → **Task 04** - Create actual tools.yaml file based on this spec
