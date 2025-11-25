/**
 * Serper API client for Reddit search via Google
 * Uses site:reddit.com with optional date filtering
 */

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  date?: string; // Publication date (e.g., "Mar 10, 2022" or "2 weeks ago")
}

interface SerperResponse {
  organic?: SerperResult[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string; // Publication date when available
}

export class SerperClient {
  constructor(private apiKey: string) {}

  /**
   * Search Reddit via Google
   * @param query Search query (site:reddit.com auto-appended)
   * @param dateAfter Optional date filter (YYYY-MM-DD format) - only results after this date
   */
  async search(query: string, dateAfter?: string): Promise<SearchResult[]> {
    // Auto-append site:reddit.com if not present
    let q = /site:\s*reddit\.com/i.test(query) ? query : `${query} site:reddit.com`;
    
    // Add date filter if provided (Google's after: operator)
    if (dateAfter) {
      q += ` after:${dateAfter}`;
    }

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, num: 10 }),
    });

    if (!res.ok) throw new Error(`Serper error: ${res.status}`);

    const data: SerperResponse = await res.json();
    return (data.organic || []).map((r) => ({
      title: r.title.replace(/ : r\/\w+$/, '').replace(/ - Reddit$/, ''),
      url: r.link,
      snippet: r.snippet,
      date: r.date, // Include publication date if available
    }));
  }

  /**
   * Search multiple queries in parallel
   * @param queries Array of search queries (max 10)
   * @param dateAfter Optional date filter for all queries
   */
  async searchMany(queries: string[], dateAfter?: string): Promise<Map<string, SearchResult[]>> {
    const results = await Promise.all(
      queries.map((q) => this.search(q, dateAfter).catch(() => []))
    );
    return new Map(queries.map((q, i) => [q, results[i]]));
  }
}
