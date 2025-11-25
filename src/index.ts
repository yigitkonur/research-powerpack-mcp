#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { searchReddit } from './tools/search-reddit.js';
import { getRedditPosts } from './tools/get-reddit-post.js';

const { SERPER_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET } = process.env;

if (!SERPER_API_KEY || !REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
  console.error('Missing env: SERPER_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'search_reddit',
    description: `Search Reddit discussions via Google. Returns 10 results per query with title, URL, and snippet.

WHEN TO USE: Finding Reddit discussions, opinions, recommendations, troubleshooting threads, or community insights on any topic.

FEATURES:
• Parallel execution: Send up to 10 queries at once
• Auto site:reddit.com: No need to add it manually
• Google search operators supported: intitle:, inurl:, "exact phrase", OR, -exclude
• Date filtering: Use date_after to find recent discussions only

QUERY TIPS:
• Use intitle: for post titles → "intitle:best laptop 2024"
• Use quotes for exact phrases → "\"react vs vue\""  
• Combine with OR → "cursor OR windsurf AI coding"
• Exclude terms → "python tutorial -beginner"
• Target subreddits in query → "site:reddit.com/r/programming"`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Search queries (max 10). Each query returns top 10 Reddit results. Examples: ["best IDE 2024", "rust vs go performance intitle:benchmark"]',
        },
        date_after: {
          type: 'string',
          description: 'Only results after this date (YYYY-MM-DD format). Example: "2024-01-01" for 2024+ content only. Useful for finding recent discussions.',
        },
      },
      required: ['queries'],
    },
  },
  {
    name: 'get_reddit_post',
    description: `Fetch full Reddit posts with comments via official Reddit API. Returns post content and threaded comments sorted by highest upvoted.

WHEN TO USE: After search_reddit finds relevant URLs, use this to get the full discussion with all valuable comments and replies.

FEATURES:
• Parallel execution: Fetch up to 5 posts simultaneously  
• Smart sorting: Comments sorted by score (most upvoted first)
• Full thread hierarchy: Nested replies preserved with proper indentation
• Configurable depth: Default 100 comments, increase to 200/500/1000 for popular threads

OUTPUT INCLUDES:
• Post: title, author, subreddit, score, body content
• Comments: author, score, [OP] tag, nested replies

MAX_COMMENTS GUIDE:
• 100 (default): Quick overview, top discussions
• 200-500: Detailed analysis, popular threads
• 1000: Comprehensive research, viral posts with 500+ comments`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reddit post URLs (max 5). Supports: reddit.com, old.reddit.com, np.reddit.com formats.',
        },
        max_comments: {
          type: 'number',
          description: 'Maximum comments to fetch per post. Default: 100. For thorough research, set 200-500. For viral threads with 1000+ comments, set 1000.',
          default: 100,
        },
      },
      required: ['urls'],
    },
  },
];

const server = new Server(
  { name: 'reddit-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'search_reddit') {
      const { queries, date_after } = args as { queries: string[]; date_after?: string };
      if (!Array.isArray(queries) || queries.length === 0) {
        return { content: [{ type: 'text', text: 'Error: queries must be a non-empty array of strings' }], isError: true };
      }
      const result = await searchReddit(queries, SERPER_API_KEY!, date_after);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'get_reddit_post') {
      const { urls, max_comments = 100 } = args as { urls: string[]; max_comments?: number };
      if (!Array.isArray(urls) || urls.length === 0) {
        return { content: [{ type: 'text', text: 'Error: urls must be a non-empty array of Reddit post URLs' }], isError: true };
      }
      const result = await getRedditPosts(urls, REDDIT_CLIENT_ID!, REDDIT_CLIENT_SECRET!, max_comments);
      return { content: [{ type: 'text', text: result }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
server.connect(transport);
console.error('Reddit Research MCP Server v2.0.0 started');
