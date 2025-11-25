# Reddit Enhanced MCP

MCP server for Reddit research: search discussions via Google, fetch posts with threaded comments.

> Need to know what devs actually think? Search Reddit, grab the top posts, read the highest-voted comments. All in one MCP server.

## Features

- **`search_reddit`** - Search Reddit via Google (Serper API). Returns 10 results per query with publication date.
- **`get_reddit_post`** - Fetch full posts with threaded comments via Reddit OAuth API. Comments sorted by score.

## Quick Start

### 1. Get API Keys

**Serper API:**
1. Sign up at [serper.dev](https://serper.dev)
2. Get your API key from dashboard

**Reddit App:**
1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Click "create another app..." → Select "script" type
3. Copy the client_id (under app name) and client_secret

### 2. Install

```bash
git clone https://github.com/yigitkonur/reddit-enhanced-mcp.git
cd reddit-enhanced-mcp
npm install
npm run build
```

### 3. Configure MCP Client

**For Windsurf / Cursor / Claude Desktop:**

Add to your MCP config (`~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "reddit": {
      "command": "node",
      "args": ["/absolute/path/to/reddit-enhanced-mcp/dist/index.js"],
      "env": {
        "SERPER_API_KEY": "your-serper-key",
        "REDDIT_CLIENT_ID": "your-reddit-client-id",
        "REDDIT_CLIENT_SECRET": "your-reddit-secret"
      }
    }
  }
}
```

## Testing

### Test with MCP Inspector

```bash
# Set your keys
export SERPER_API_KEY="your-key"
export REDDIT_CLIENT_ID="your-id"
export REDDIT_CLIENT_SECRET="your-secret"

# List tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Test search
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name search_reddit \
  --tool-arg 'queries=["cursor vs windsurf"]'

# Test post fetch
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name get_reddit_post \
  --tool-arg 'urls=["https://www.reddit.com/r/ChatGPTCoding/comments/1htlx48/"]'
```

## Tool Parameters

### `search_reddit`
| Parameter | Type | Description |
|-----------|------|-------------|
| `queries` | `string[]` | Search queries (max 10, parallel) |
| `date_after` | `string?` | Filter: only results after YYYY-MM-DD |

### `get_reddit_post`
| Parameter | Type | Description |
|-----------|------|-------------|
| `urls` | `string[]` | Reddit post URLs (max 5, parallel) |
| `max_comments` | `number?` | Max comments per post (default: 100) |

## Output Examples

**Search:**
```
## 🔍 "cursor vs windsurf"

**1. Cursor vs. Windsurf: Real-World Experience** • 📅 5 months ago
https://reddit.com/r/ChatGPTCoding/comments/...
> I've tried both and found the results are quite similar...
```

**Post:**
```
## Cursor vs. Windsurf: Real-World Experience

**r/ChatGPTCoding** • u/furkangulsen • ⬆️ 168 • 💬 122 comments

### Top Comments (20/122 shown, sorted by score)

- **u/moosepiss** _(+83)_
  I keep bouncing back and forth...

  - **u/furkangulsen** **[OP]** _(+7)_
    Totally agree with your points...
```

## License

MIT
