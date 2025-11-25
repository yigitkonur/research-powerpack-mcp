import { SerperClient } from '../lib/serper.js';

/**
 * Search Reddit via Google (Serper API)
 * Parallel execution, max 10 queries, 10 results each
 */
export async function searchReddit(
  queries: string[],
  apiKey: string,
  dateAfter?: string
): Promise<string> {
  const limited = queries.slice(0, 10);
  const client = new SerperClient(apiKey);
  const results = await client.searchMany(limited, dateAfter);

  let md = '';
  for (const [query, items] of results) {
    md += `## 🔍 "${query}"${dateAfter ? ` (after ${dateAfter})` : ''}\n\n`;
    if (items.length === 0) {
      md += '_No results found_\n\n';
      continue;
    }
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const dateStr = r.date ? ` • 📅 ${r.date}` : '';
      md += `**${i + 1}. ${r.title}**${dateStr}\n`;
      md += `${r.url}\n`;
      md += `> ${r.snippet}\n\n`;
    }
  }
  return md.trim();
}
