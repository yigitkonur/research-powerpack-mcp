import { RedditClient, type PostResult, type Comment } from '../lib/reddit.js';

/**
 * Format comments with hierarchical indentation
 * Preserves thread structure with visual nesting
 */
function formatComments(comments: Comment[]): string {
  let md = '';
  for (const c of comments) {
    const indent = '  '.repeat(c.depth);
    const op = c.isOP ? ' **[OP]**' : '';
    const score = c.score >= 0 ? `+${c.score}` : `${c.score}`;
    md += `${indent}- **u/${c.author}**${op} _(${score})_\n`;
    // Indent comment body lines
    const bodyLines = c.body.split('\n').map(line => `${indent}  ${line}`).join('\n');
    md += `${bodyLines}\n\n`;
  }
  return md;
}

/**
 * Format a single post with metadata and comments
 */
function formatPost(result: PostResult, commentCount: number): string {
  const { post, comments } = result;
  let md = `## ${post.title}\n\n`;
  md += `**r/${post.subreddit}** • u/${post.author} • ⬆️ ${post.score} • 💬 ${post.commentCount} comments\n`;
  md += `🔗 ${post.url}\n\n`;

  if (post.body) {
    md += `### Post Content\n\n${post.body}\n\n`;
  }

  if (comments.length > 0) {
    md += `### Top Comments (${comments.length}/${post.commentCount} shown, sorted by score)\n\n`;
    md += formatComments(comments);
  }

  return md;
}

/**
 * Fetch Reddit posts with comments in parallel
 * Sorted by highest upvoted, preserves full thread hierarchy
 */
export async function getRedditPosts(
  urls: string[],
  clientId: string,
  clientSecret: string,
  maxComments: number = 100
): Promise<string> {
  const limited = urls.slice(0, 5);
  const client = new RedditClient(clientId, clientSecret);
  const results = await client.getPosts(limited, maxComments);

  let md = '';
  for (const [url, result] of results) {
    if (result instanceof Error) {
      md += `## ❌ Failed: ${url}\n\n_${result.message}_\n\n---\n\n`;
    } else {
      md += formatPost(result, maxComments);
      md += '\n---\n\n';
    }
  }

  return md.trim();
}
