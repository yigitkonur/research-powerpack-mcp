# Parallel Execution Tests

Verify parallelism, rate limiting, and exponential backoff in the MCP server.

## Quick Start

```bash
cp .env.example .env     # Add your API keys
npm run test:check       # Verify setup
npm run test:all         # Run all tests
```

## Tests Overview

| Test | Requests | Concurrency | API Key |
|------|----------|-------------|---------|
| `npm run test:web-search` | 30 keywords | All parallel | `SERPER_API_KEY` |
| `npm run test:reddit-search` | 10 queries | All parallel | `SERPER_API_KEY` |
| `npm run test:scrape-links` | 50 URLs | Sliding window (30 max) | `SCRAPEDO_API_KEY` |
| `npm run test:deep-research` | 10 questions | All parallel | `OPENROUTER_API_KEY` |

## Expected Results

| Test | Duration | Spread | Verdict |
|------|----------|--------|---------|
| Web Search | ~1.2s | 16ms | ✅ Parallel |
| Reddit Search | ~1.2s | 13ms | ✅ Parallel |
| Scrape Links | ~6.5s | 39ms | ✅ Sliding window |
| Deep Research | ~18s | 0ms | ✅ Parallel |

## Retry Logic

**Exponential backoff:** 500ms → 1s → 2s → 4s → 8s → 10s (max), up to 20 retries

### Scrape.do Status Codes

| Code | Action | Credit |
|------|--------|--------|
| 2xx | Success | ✅ Yes |
| 429 | **Retry** (rate limited) | ❌ No |
| 502 | **Retry** (request failed) | ❌ No |
| 510 | **Retry** (canceled) | ❌ No |
| 404 | Return error (not found) | ✅ Yes |
| 401 | Fail (no credits) | ❌ No |
| 400 | Fail (bad request) | Depends |

## Output

Logs saved to `test-logs/`:
- `.log` - Human-readable timeline
- `.json` - Structured data with parallelism analysis

## Troubleshooting

**Missing API key:** Run `npm run test:check` to see which keys are missing.

**Rate limiting:** Tests auto-retry with backoff. Many retries = reduce concurrency or check API limits.

**Low parallelism:** Check for blocking code or API-side throttling.
