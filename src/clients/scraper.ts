/**
 * Web Scraper Client
 * Generic interface for URL scraping with automatic fallback modes
 */

import { parseEnv, SCRAPER } from '../config/index.js';

export interface ScrapeRequest {
  url: string;
  mode?: 'basic' | 'javascript';
  timeout?: number;
  country?: string;
}

export interface ScrapeResponse {
  content: string;
  statusCode: number;
  credits: number;
  headers?: Record<string, string>;
}

export interface BatchScrapeResult {
  results: Array<ScrapeResponse & { url: string }>;
  batchesProcessed: number;
  totalAttempted: number;
  rateLimitHits: number;
}

export class ScraperClient {
  private apiKey: string;
  private baseURL = 'https://api.scrape.do';

  constructor(apiKey?: string) {
    const env = parseEnv();
    this.apiKey = apiKey || env.SCRAPER_API_KEY;

    if (!this.apiKey) {
      throw new Error('SCRAPEDO_API_KEY is required');
    }
  }

  async scrape(request: ScrapeRequest, maxRetries = SCRAPER.RETRY_COUNT): Promise<ScrapeResponse> {
    const { url, mode = 'basic', timeout = 30, country } = request;

    const params = new URLSearchParams({
      url: url,
      token: this.apiKey,
      timeout: String(timeout * 1000),
    });

    if (mode === 'javascript') {
      params.append('render', 'true');
    }

    if (country) {
      params.append('geoCode', country.toUpperCase());
    }

    const apiUrl = `${this.baseURL}?${params.toString()}`;

    // ============================================================
    // Scrape.do Status Code Handling (based on official docs)
    // ============================================================
    // RETRY (no credit consumed): 429, 502, 510
    // NO RETRY: 404 (permanent), 401 (no credits), 400 (bad request)
    // SUCCESS: 2xx (consumes credit)
    // ============================================================

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: { Accept: 'text/html,application/json' },
        });

        const content = await response.text();
        const credits = mode === 'javascript' ? 5 : 1;

        // SUCCESS: 2xx - Successful API call (consumes credit)
        if (response.ok) {
          return {
            content,
            statusCode: response.status,
            credits,
            headers: Object.fromEntries(response.headers.entries()),
          };
        }

        // RETRY: 429 - Rate limited (no credit consumed)
        if (response.status === 429) {
          if (attempt < maxRetries - 1) {
            const delayMs = SCRAPER.RETRY_DELAYS[attempt] || 8000;
            console.error(`[Scraper] Rate limited (429) - no credit used. Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
            await this.delay(delayMs);
            continue;
          }
          throw new Error('Rate limited (429). Try fewer concurrent URLs or retry later.');
        }

        // RETRY: 502 - Request failed (no credit consumed)
        if (response.status === 502) {
          if (attempt < maxRetries - 1) {
            const delayMs = SCRAPER.RETRY_DELAYS[attempt] || 8000;
            console.error(`[Scraper] Request failed (502) - no credit used. Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
            await this.delay(delayMs);
            continue;
          }
          throw new Error('Request failed (502). Please try again.');
        }

        // RETRY: 510 - Request canceled by HTTP client (no credit consumed)
        if (response.status === 510) {
          if (attempt < maxRetries - 1) {
            const delayMs = SCRAPER.RETRY_DELAYS[attempt] || 8000;
            console.error(`[Scraper] Request canceled (510) - no credit used. Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
            await this.delay(delayMs);
            continue;
          }
          throw new Error('Request canceled (510). Please try again.');
        }

        // NO RETRY: 404 - Target not found (consumes credit, permanent error)
        if (response.status === 404) {
          return { content: '404 - Target not found', statusCode: 404, credits };
        }

        // NO RETRY: 401 - No credits or subscription suspended (no credit consumed)
        if (response.status === 401) {
          throw new Error('No credits remaining or subscription suspended (401). Check your Scrape.do account.');
        }

        // NO RETRY: 400 - Bad request (may or may not consume credit, permanent error)
        if (response.status === 400) {
          throw new Error(`Bad request (400): ${content.substring(0, 200)}`);
        }

        // Other unexpected errors - retry if attempts remaining
        if (attempt < maxRetries - 1) {
          const delayMs = SCRAPER.RETRY_DELAYS[attempt] || 8000;
          console.error(`[Scraper] Unexpected status (${response.status}). Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
          await this.delay(delayMs);
          continue;
        }

        throw new Error(`Scraper error: ${response.status} ${content.substring(0, 200)}`);
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw new Error(`Failed to scrape URL after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Network errors - retry with backoff
        if (error instanceof Error && 
            !error.message.includes('(401)') && 
            !error.message.includes('(400)') &&
            !error.message.includes('Target not found')) {
          const delayMs = SCRAPER.RETRY_DELAYS[attempt] || 8000;
          console.error(`[Scraper] Error: ${error.message}. Retry ${attempt + 1}/${maxRetries} after ${delayMs}ms`);
          await this.delay(delayMs);
        } else {
          throw error;
        }
      }
    }

    throw new Error('Unexpected retry loop exit');
  }

  async scrapeWithFallback(url: string, options: { timeout?: number } = {}): Promise<ScrapeResponse> {
    const attempts: Array<{ mode: 'basic' | 'javascript'; country?: string; description: string }> = [
      { mode: 'basic', description: 'basic mode' },
      { mode: 'javascript', description: 'javascript rendering' },
      { mode: 'javascript', country: 'us', description: 'javascript + US geo-targeting' },
    ];

    const attemptResults: string[] = [];

    for (const attempt of attempts) {
      try {
        const result = await this.scrape({
          url,
          mode: attempt.mode,
          timeout: options.timeout,
          country: attempt.country,
        });

        if (result.statusCode >= 200 && result.statusCode < 300) {
          if (attemptResults.length > 0) {
            console.error(`[Scraper] Success with ${attempt.description} after ${attemptResults.length} failed attempt(s)`);
          }
          return result;
        }

        if (result.statusCode === 404) {
          return { content: '404 - Page not found', statusCode: 404, credits: result.credits };
        }

        attemptResults.push(`${attempt.description}: ${result.statusCode}`);
        console.error(`[Scraper] Failed with ${attempt.description} (status: ${result.statusCode}), trying next fallback...`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        attemptResults.push(`${attempt.description}: ${msg}`);
        console.error(`[Scraper] Error with ${attempt.description}: ${msg}`);
      }
    }

    throw new Error(`Failed to scrape ${url} after trying all fallback modes:\n${attemptResults.join('\n')}`);
  }

  async scrapeMultiple(urls: string[], options: { timeout?: number } = {}): Promise<Array<ScrapeResponse & { url: string }>> {
    if (urls.length <= SCRAPER.BATCH_SIZE) {
      return this.processBatch(urls, options);
    }

    const result = await this.batchScrape(urls, options);
    return result.results;
  }

  async batchScrape(
    urls: string[],
    options: { timeout?: number } = {},
    onBatchComplete?: (batchNum: number, totalBatches: number, processed: number) => void
  ): Promise<BatchScrapeResult> {
    const totalBatches = Math.ceil(urls.length / SCRAPER.BATCH_SIZE);
    const allResults: Array<ScrapeResponse & { url: string }> = [];
    let rateLimitHits = 0;

    console.error(`[Scraper] Starting batch processing: ${urls.length} URLs in ${totalBatches} batch(es)`);

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const startIdx = batchNum * SCRAPER.BATCH_SIZE;
      const endIdx = Math.min(startIdx + SCRAPER.BATCH_SIZE, urls.length);
      const batchUrls = urls.slice(startIdx, endIdx);

      console.error(`[Scraper] Processing batch ${batchNum + 1}/${totalBatches} (${batchUrls.length} URLs)`);

      const batchResults = await Promise.allSettled(
        batchUrls.map(url => this.scrapeWithFallback(url, options))
      );

      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const url = batchUrls[i] || '';

        if (result.status === 'fulfilled') {
          allResults.push({ ...result.value, url });
        } else {
          const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);

          if (errorMsg.includes('rate limited') || errorMsg.includes('429')) {
            rateLimitHits++;
          }

          allResults.push({ url, content: `Error: ${errorMsg}`, statusCode: 500, credits: 0 });
        }
      }

      onBatchComplete?.(batchNum + 1, totalBatches, allResults.length);
      console.error(`[Scraper] Completed batch ${batchNum + 1}/${totalBatches} (${allResults.length}/${urls.length} total)`);

      if (batchNum < totalBatches - 1) {
        await this.delay(500);
      }
    }

    return { results: allResults, batchesProcessed: totalBatches, totalAttempted: urls.length, rateLimitHits };
  }

  private async processBatch(urls: string[], options: { timeout?: number }): Promise<Array<ScrapeResponse & { url: string }>> {
    const results = await Promise.allSettled(urls.map(url => this.scrapeWithFallback(url, options)));

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return { ...result.value, url: urls[index] || '' };
      }
      return { url: urls[index] || '', content: `Error: ${result.reason}`, statusCode: 500, credits: 0 };
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
