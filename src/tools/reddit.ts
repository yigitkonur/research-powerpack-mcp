/**
 * Reddit Tools - Search and Fetch
 */

import { SearchClient } from '../clients/search.js';
import { RedditClient, calculateCommentAllocation, type PostResult, type Comment } from '../clients/reddit.js';
import { aggregateAndRankReddit, generateRedditEnhancedOutput } from '../utils/url-aggregator.js';
import { REDDIT } from '../config/index.js';

// ============================================================================
// Formatters
// ============================================================================

function formatComments(comments: Comment[]): string {
  let md = '';
  for (const c of comments) {
    const indent = '  '.repeat(c.depth);
    const op = c.isOP ? ' **[OP]**' : '';
    const score = c.score >= 0 ? `+${c.score}` : `${c.score}`;
    md += `${indent}- **u/${c.author}**${op} _(${score})_\n`;
    const bodyLines = c.body.split('\n').map(line => `${indent}  ${line}`).join('\n');
    md += `${bodyLines}\n\n`;
  }
  return md;
}

function formatPost(result: PostResult, fetchComments: boolean): string {
  const { post, comments, allocatedComments } = result;
  let md = `## ${post.title}\n\n`;
  md += `**r/${post.subreddit}** • u/${post.author} • ⬆️ ${post.score} • 💬 ${post.commentCount} comments\n`;
  md += `🔗 ${post.url}\n\n`;

  if (post.body) {
    md += `### Post Content\n\n${post.body}\n\n`;
  }

  if (fetchComments && comments.length > 0) {
    md += `### Top Comments (${comments.length}/${post.commentCount} shown, allocated: ${allocatedComments})\n\n`;
    md += formatComments(comments);
  } else if (!fetchComments) {
    md += `_Comments not fetched (fetch_comments=false)_\n\n`;
  }

  return md;
}

// ============================================================================
// Search Reddit Handler
// ============================================================================

export async function handleSearchReddit(
  queries: string[],
  apiKey: string,
  dateAfter?: string
): Promise<string> {
  const limited = queries.slice(0, 10);
  const client = new SearchClient(apiKey);
  const results = await client.searchRedditMultiple(limited, dateAfter);

  // Check if any results were found
  let totalResults = 0;
  for (const items of results.values()) {
    totalResults += items.length;
  }

  if (totalResults === 0) {
    return `# 🔍 Reddit Search Results\n\n_No results found for any of the ${limited.length} queries._`;
  }

  // Aggregate and rank results by CTR
  const aggregation = aggregateAndRankReddit(results, 3);

  // Generate enhanced output with consensus highlighting
  return generateRedditEnhancedOutput(aggregation, limited);
}

// ============================================================================
// Get Reddit Posts Handler
// ============================================================================

export interface GetRedditPostsOptions {
  fetchComments?: boolean;
  maxCommentsOverride?: number;
}

export async function handleGetRedditPosts(
  urls: string[],
  clientId: string,
  clientSecret: string,
  maxComments = 100,
  options: GetRedditPostsOptions = {}
): Promise<string> {
  const { fetchComments = true, maxCommentsOverride } = options;

  if (urls.length < REDDIT.MIN_POSTS) {
    return `# ❌ Error\n\nMinimum ${REDDIT.MIN_POSTS} Reddit posts required. Received: ${urls.length}`;
  }
  if (urls.length > REDDIT.MAX_POSTS) {
    return `# ❌ Error\n\nMaximum ${REDDIT.MAX_POSTS} Reddit posts allowed. Received: ${urls.length}. Please remove ${urls.length - REDDIT.MAX_POSTS} URL(s) and retry.`;
  }

  const allocation = calculateCommentAllocation(urls.length);
  const commentsPerPost = fetchComments ? (maxCommentsOverride || allocation.perPostCapped) : 0;
  const totalBatches = Math.ceil(urls.length / REDDIT.BATCH_SIZE);

  const client = new RedditClient(clientId, clientSecret);
  const batchResult = await client.batchGetPosts(urls, commentsPerPost, fetchComments);
  const results = batchResult.results;

  let md = `# Reddit Posts (${urls.length} posts)\n\n`;

  if (fetchComments) {
    md += `**Comment Allocation:** ${commentsPerPost} comments/post (${urls.length} posts, ${REDDIT.MAX_COMMENT_BUDGET} total budget)\n`;
  } else {
    md += `**Comments:** Not fetched (fetch_comments=false)\n`;
  }
  md += `**Status:** 📦 ${totalBatches} batch(es) processed\n\n`;
  md += `---\n\n`;

  let successful = 0;
  let failed = 0;

  for (const [url, result] of results) {
    if (result instanceof Error) {
      failed++;
      md += `## ❌ Failed: ${url}\n\n_${result.message}_\n\n---\n\n`;
    } else {
      successful++;
      md += formatPost(result, fetchComments);
      md += '\n---\n\n';
    }
  }

  md += `\n**Summary:** ✅ ${successful} successful | ❌ ${failed} failed`;
  if (batchResult.rateLimitHits > 0) {
    md += ` | ⚠️ ${batchResult.rateLimitHits} rate limit retries`;
  }

  return md.trim();
}
