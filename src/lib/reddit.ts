/**
 * Reddit OAuth API client
 * Fetches posts and comments sorted by score (most upvoted first)
 */

export interface Post {
  title: string;
  author: string;
  subreddit: string;
  body: string;
  score: number;
  commentCount: number;
  url: string;
}

export interface Comment {
  author: string;
  body: string;
  score: number;
  depth: number;
  isOP: boolean;
}

export interface PostResult {
  post: Post;
  comments: Comment[];
}

export class RedditClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(private clientId: string, private clientSecret: string) {}

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 60000) return this.token;

    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'reddit-mcp/2.0',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) throw new Error(`Reddit auth failed: ${res.status}`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.token!;
  }

  private parseUrl(url: string): { sub: string; id: string } | null {
    const m = url.match(/reddit\.com\/r\/([^\/]+)\/comments\/([a-z0-9]+)/i);
    return m ? { sub: m[1], id: m[2] } : null;
  }

  /**
   * Fetch a Reddit post with comments
   * @param url Reddit post URL
   * @param maxComments Maximum comments to return (default 100)
   * Uses sort=top for highest upvoted, depth=10 for full thread hierarchy
   */
  async getPost(url: string, maxComments: number = 100): Promise<PostResult> {
    const parsed = this.parseUrl(url);
    if (!parsed) throw new Error(`Invalid Reddit URL: ${url}`);

    const token = await this.auth();
    // sort=top: pure upvote ranking (highest voted first)
    // limit=500: max per request (API limit)
    // depth=10: capture full thread hierarchy
    const limit = Math.min(maxComments, 500);
    const res = await fetch(
      `https://oauth.reddit.com/r/${parsed.sub}/comments/${parsed.id}?sort=top&limit=${limit}&depth=10&raw_json=1`,
      { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'reddit-mcp/2.0' } }
    );

    if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
    const [postListing, commentListing] = await res.json();

    const p = postListing?.data?.children?.[0]?.data;
    if (!p) throw new Error(`Post not found: ${url}`);

    const post: Post = {
      title: p.title,
      author: p.author,
      subreddit: p.subreddit,
      body: p.selftext || (p.is_self ? '' : `[Link: ${p.url}]`),
      score: p.score,
      commentCount: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
    };

    // Extract comments preserving thread hierarchy, sorted by score
    const comments: Comment[] = [];
    const extract = (children: any[], depth = 0) => {
      // Sort children by score at each level (highest first)
      const sorted = [...children].sort((a, b) => (b.data?.score || 0) - (a.data?.score || 0));
      for (const c of sorted) {
        if (comments.length >= maxComments) return;
        if (c.kind !== 't1' || !c.data?.author || c.data.author === '[deleted]') continue;
        comments.push({
          author: c.data.author,
          body: c.data.body || '',
          score: c.data.score,
          depth,
          isOP: c.data.author === p.author,
        });
        // Recurse into replies to preserve full thread
        if (c.data.replies?.data?.children && comments.length < maxComments) {
          extract(c.data.replies.data.children, depth + 1);
        }
      }
    };
    if (commentListing?.data?.children) extract(commentListing.data.children);

    return { post, comments };
  }

  /**
   * Fetch multiple posts in parallel
   * @param urls Array of Reddit URLs (max 5)
   * @param maxComments Max comments per post
   */
  async getPosts(urls: string[], maxComments: number = 100): Promise<Map<string, PostResult | Error>> {
    const results = await Promise.all(
      urls.map((u) => this.getPost(u, maxComments).catch((e) => e as Error))
    );
    return new Map(urls.map((u, i) => [u, results[i]]));
  }
}
