#!/usr/bin/env node

/**
 * Research Powerpack MCP Server
 * Implements robust error handling - server NEVER crashes on tool failures
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS } from './tools/definitions.js';
import { handleSearchReddit, handleGetRedditPosts } from './tools/reddit.js';
import { handleDeepResearch } from './tools/research.js';
import { handleScrapeLinks } from './tools/scrape.js';
import { handleWebSearch } from './tools/search.js';
import { deepResearchParamsSchema } from './schemas/deep-research.js';
import { scrapeLinksParamsSchema } from './schemas/scrape-links.js';
import { webSearchParamsSchema } from './schemas/web-search.js';
import { classifyError, ErrorCode, type StructuredError } from './utils/errors.js';
import { parseEnv, RESEARCH, SERVER, getCapabilities, getMissingEnvMessage } from './config/index.js';

// ============================================================================
// Capability Detection (no ENV required - tools fail gracefully when called)
// ============================================================================

const env = parseEnv();
const capabilities = getCapabilities();

// Log available capabilities for debugging
const enabledTools: string[] = [];
const disabledTools: string[] = [];

if (capabilities.search) {
  enabledTools.push('web_search', 'search_reddit');
} else {
  disabledTools.push('web_search', 'search_reddit');
}
if (capabilities.reddit) {
  enabledTools.push('get_reddit_post');
} else {
  disabledTools.push('get_reddit_post');
}
if (capabilities.scraping) {
  enabledTools.push('scrape_links');
} else {
  disabledTools.push('scrape_links');
}
if (capabilities.deepResearch) {
  enabledTools.push('deep_research');
} else {
  disabledTools.push('deep_research');
}

if (enabledTools.length > 0) {
  console.error(`✅ Enabled tools: ${enabledTools.join(', ')}`);
}
if (disabledTools.length > 0) {
  console.error(`⚠️ Disabled tools (missing ENV): ${disabledTools.join(', ')}`);
}
if (capabilities.scraping && !capabilities.llmExtraction) {
  console.error(`ℹ️ scrape_links: AI extraction (use_llm) disabled - set OPENROUTER_API_KEY to enable`);
}

// ============================================================================
// Server Setup
// ============================================================================

const server = new Server(
  { name: SERVER.NAME, version: SERVER.VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ========== SEARCH_REDDIT ==========
    if (name === 'search_reddit') {
      // Check capability
      if (!capabilities.search) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('search') }], isError: true };
      }
      const { queries, date_after } = args as { queries: string[]; date_after?: string };
      if (!Array.isArray(queries) || queries.length === 0) {
        return { content: [{ type: 'text', text: 'Error: queries must be a non-empty array of strings' }], isError: true };
      }
      const result = await handleSearchReddit(queries, env.SEARCH_API_KEY!, date_after);
      return { content: [{ type: 'text', text: result }] };
    }

    // ========== GET_REDDIT_POST ==========
    if (name === 'get_reddit_post') {
      // Check capability
      if (!capabilities.reddit) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('reddit') }], isError: true };
      }
      const { urls, max_comments = 100, fetch_comments = true } = args as { urls: string[]; max_comments?: number; fetch_comments?: boolean };
      if (!Array.isArray(urls) || urls.length === 0) {
        return { content: [{ type: 'text', text: 'Error: urls must be a non-empty array of Reddit post URLs' }], isError: true };
      }
      const result = await handleGetRedditPosts(urls, env.REDDIT_CLIENT_ID!, env.REDDIT_CLIENT_SECRET!, max_comments, {
        fetchComments: fetch_comments,
        maxCommentsOverride: max_comments !== 100 ? max_comments : undefined,
      });
      return { content: [{ type: 'text', text: result }] };
    }

    // ========== DEEP_RESEARCH ==========
    if (name === 'deep_research') {
      // Check capability
      if (!capabilities.deepResearch) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('deepResearch') }], isError: true };
      }
      const validatedParams = deepResearchParamsSchema.parse(args);
      const { content, structuredContent } = await handleDeepResearch(validatedParams);
      if (structuredContent && typeof structuredContent === 'object' && 'error' in structuredContent && structuredContent.error) {
        return { content: [{ type: 'text', text: content }], isError: true };
      }
      return { content: [{ type: 'text', text: content }] };
    }

    // ========== SCRAPE_LINKS ==========
    if (name === 'scrape_links') {
      // Check capability
      if (!capabilities.scraping) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('scraping') }], isError: true };
      }
      const validatedParams = scrapeLinksParamsSchema.parse(args);
      
      // Warn if use_llm requested but LLM not available
      if (validatedParams.use_llm && !capabilities.llmExtraction) {
        console.error('[scrape_links] use_llm requested but OPENROUTER_API_KEY not set - proceeding without AI extraction');
        validatedParams.use_llm = false;
      }
      
      const { content, structuredContent } = await handleScrapeLinks(validatedParams);
      if (structuredContent.metadata.failed === structuredContent.metadata.total_urls) {
        return { content: [{ type: 'text', text: content }], isError: true };
      }
      return { content: [{ type: 'text', text: content }] };
    }

    // ========== WEB_SEARCH ==========
    if (name === 'web_search') {
      // Check capability
      if (!capabilities.search) {
        return { content: [{ type: 'text', text: getMissingEnvMessage('search') }], isError: true };
      }
      const validatedParams = webSearchParamsSchema.parse(args);
      const { content, structuredContent } = await handleWebSearch(validatedParams);
      if (structuredContent.metadata.total_results === 0) {
        return { content: [{ type: 'text', text: content }], isError: true };
      }
      return { content: [{ type: 'text', text: content }] };
    }

    return { content: [{ type: 'text', text: `⚠️ **Unknown tool:** \`${name}\`\n\nAvailable tools: search_reddit, get_reddit_post, deep_research, scrape_links, web_search` }], isError: true };
  } catch (error) {
    // Classify the error for helpful messaging
    const structuredError = classifyError(error);

    // Log for debugging
    console.error(`[MCP Server] Tool "${name}" error:`, {
      code: structuredError.code,
      message: structuredError.message,
      retryable: structuredError.retryable,
    });

    // Format user-friendly error message
    const retryHint = structuredError.retryable ? '\n\n💡 This error may be temporary. Try again in a moment.' : '';
    const errorText = `## ❌ Error\n\n**${structuredError.code}:** ${structuredError.message}${retryHint}\n\nPlease check your input parameters and try again.`;

    // ALWAYS return a valid response - never let the server crash
    return { content: [{ type: 'text', text: errorText }], isError: true };
  }
});

// ============================================================================
// Global Error Handlers - Prevent server crashes
// ============================================================================

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  console.error('[MCP Server] Uncaught exception (server continues):', error.message);
  // Don't exit - the server should continue running
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  const error = classifyError(reason);
  console.error('[MCP Server] Unhandled rejection (server continues):', error.message);
  // Don't exit - the server should continue running
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  console.error('[MCP Server] Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Handle SIGINT gracefully (Ctrl+C)
process.on('SIGINT', () => {
  console.error('[MCP Server] Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// ============================================================================
// Start Server
// ============================================================================

const transport = new StdioServerTransport();

// Connect with error handling
try {
  server.connect(transport);
  console.error(`🚀 ${SERVER.NAME} v${SERVER.VERSION} ready`);
} catch (error) {
  const err = classifyError(error);
  console.error(`[MCP Server] Failed to start: ${err.message}`);
  process.exit(1);
}
