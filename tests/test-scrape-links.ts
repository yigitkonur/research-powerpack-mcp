#!/usr/bin/env tsx
/**
 * Scrape Links Parallel Test
 * Tests 50 URLs with max 30 concurrency
 * Uses "what is my IP" style sites with number-to-text conversion prompts
 * Retry: exponential backoff (2x, max 10s, 20 retries)
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Setup
const LOG_DIR = join(process.cwd(), 'test-logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `scrape-links-${TIMESTAMP}.log`);

// ============================================================================
// Logger & Tracking
// ============================================================================

interface ParallelEvent {
  timestamp: number;
  id: string;
  type: 'start' | 'end' | 'retry' | 'batch-start' | 'batch-end';
  data?: Record<string, unknown>;
}

const events: ParallelEvent[] = [];
const logs: string[] = [];

function log(message: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}`;
  logs.push(line);
  console.log(line);
}

function trackStart(id: string): void {
  events.push({ timestamp: Date.now(), id, type: 'start' });
  log(`START: ${id}`);
}

function trackEnd(id: string, success: boolean, data?: Record<string, unknown>): void {
  events.push({ timestamp: Date.now(), id, type: 'end', data: { success, ...data } });
  log(`END: ${id} (${success ? 'SUCCESS' : 'FAILED'})`, data);
}

function trackRetry(id: string, attempt: number, delay: number, error: string): void {
  events.push({ timestamp: Date.now(), id, type: 'retry', data: { attempt, delay, error } });
  log(`RETRY: ${id} attempt ${attempt}, waiting ${delay}ms`, { error: error.substring(0, 100) });
}

function trackBatch(type: 'start' | 'end', batchNum: number, total: number): void {
  events.push({ timestamp: Date.now(), id: `batch-${batchNum}`, type: `batch-${type}` as any, data: { batchNum, total } });
  log(`BATCH ${type.toUpperCase()}: ${batchNum}/${total}`);
}

// ============================================================================
// Retry Logic
// ============================================================================

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 20,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  multiplier: 2,
};

function calculateDelay(attempt: number): number {
  const delay = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.multiplier, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Number to Words (for prompts)
// ============================================================================

function numberToWords(n: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
                'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const scales = ['', 'thousand', 'million', 'billion'];
  
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  
  let result = '';
  let scaleIdx = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) {
      result = numberToWords(chunk) + (scales[scaleIdx] ? ' ' + scales[scaleIdx] : '') + (result ? ' ' + result : '');
    }
    n = Math.floor(n / 1000);
    scaleIdx++;
  }
  return result;
}

// ============================================================================
// URL Generation
// ============================================================================

function generateTestUrls(count: number): string[] {
  // Reliable IP check services (removed freegeoip.app - 404, ip-api.com - 502)
  const ipServices = [
    'https://api.ipify.org',
    'https://icanhazip.com',
    'https://ifconfig.me/ip',
    'https://checkip.amazonaws.com',
    'https://ipecho.net/plain',
    'https://ipinfo.io/ip',
    'https://ident.me',
    'https://v4.ident.me',
    'https://httpbin.org/ip',
    'https://httpbin.org/headers',
    'https://httpbin.org/user-agent',
    'https://api.myip.com',
    'https://api64.ipify.org',
    'https://ipv4.icanhazip.com',
    'https://jsonip.com',
    'https://wtfismyip.com/json',
    'https://api.db-ip.com/v2/free/self',
  ];
  
  const urls: string[] = [];
  for (let i = 0; i < count; i++) {
    urls.push(ipServices[i % ipServices.length]);
  }
  return urls;
}

// ============================================================================
// Scrape Function with Retry
// ============================================================================

interface ScrapeResult {
  url: string;
  success: boolean;
  statusCode: number;
  contentLength: number;
  duration: number;
  retries: number;
  ipFound?: string;
  convertedToWords?: string;
  error?: string;
}

async function scrapeUrl(
  url: string,
  apiKey: string,
  index: number
): Promise<ScrapeResult> {
  const opId = `scrape-${index}-${new URL(url).hostname}`;
  const startTime = Date.now();
  
  trackStart(opId);
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const params = new URLSearchParams({
        url: url,
        token: apiKey,
        timeout: '30000',
      });
      
      const response = await fetch(`https://api.scrape.do?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'text/html,application/json,text/plain' },
      });
      
      const content = await response.text();
      const duration = Date.now() - startTime;
      
      // ============================================================
      // Scrape.do Status Code Handling (based on official docs)
      // ============================================================
      
      // RETRY: 429 - Rate limited (no credit consumed)
      if (response.status === 429) {
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delayMs = calculateDelay(attempt);
          trackRetry(opId, attempt + 1, delayMs, `Rate limited (429) - no credit used, retrying`);
          await delay(delayMs);
          continue;
        }
      }
      
      // RETRY: 502 - Request failed (no credit consumed)
      if (response.status === 502) {
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delayMs = calculateDelay(attempt);
          trackRetry(opId, attempt + 1, delayMs, `Request failed (502) - no credit used, retrying`);
          await delay(delayMs);
          continue;
        }
      }
      
      // RETRY: 510 - Request canceled by HTTP client (no credit consumed)
      if (response.status === 510) {
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delayMs = calculateDelay(attempt);
          trackRetry(opId, attempt + 1, delayMs, `Request canceled (510) - no credit used, retrying`);
          await delay(delayMs);
          continue;
        }
      }
      
      // NO RETRY: 404 - Target not found (consumes credit, permanent error)
      if (response.status === 404) {
        trackEnd(opId, false, { 
          status: 404, 
          error: 'Target not found (404) - credit consumed',
          duration,
        });
        return {
          url,
          success: false,
          statusCode: 404,
          contentLength: content.length,
          duration,
          retries: events.filter(e => e.id === opId && e.type === 'retry').length,
          error: 'Target not found (404) - no retry (permanent)',
        };
      }
      
      // NO RETRY: 401 - No credits or subscription suspended (no credit consumed)
      if (response.status === 401) {
        trackEnd(opId, false, { 
          status: 401, 
          error: 'No credits or subscription suspended (401)',
          duration,
        });
        return {
          url,
          success: false,
          statusCode: 401,
          contentLength: 0,
          duration,
          retries: events.filter(e => e.id === opId && e.type === 'retry').length,
          error: 'No credits or subscription suspended (401) - check your account',
        };
      }
      
      // NO RETRY: 400 - Bad request (may or may not consume credit)
      if (response.status === 400) {
        trackEnd(opId, false, { 
          status: 400, 
          error: 'Bad request (400)',
          duration,
        });
        return {
          url,
          success: false,
          statusCode: 400,
          contentLength: content.length,
          duration,
          retries: events.filter(e => e.id === opId && e.type === 'retry').length,
          error: 'Bad request (400) - no retry (permanent)',
        };
      }
      
      // SUCCESS: 2xx - Successful API call (consumes credit)
      if (response.ok) {
        // Try to extract IP from content
        let ipFound: string | undefined;
        let convertedToWords: string | undefined;
        
        const ipMatch = content.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
        if (ipMatch) {
          ipFound = ipMatch[1];
          const octets = ipFound.split('.').map(n => numberToWords(parseInt(n)));
          convertedToWords = octets.join(' dot ');
        }
        
        trackEnd(opId, true, { 
          status: response.status, 
          contentLength: content.length,
          ipFound,
          convertedToWords,
          duration,
        });
        
        return {
          url,
          success: true,
          statusCode: response.status,
          contentLength: content.length,
          duration,
          retries: events.filter(e => e.id === opId && e.type === 'retry').length,
          ipFound,
          convertedToWords,
        };
      }
      
      // Other errors - log and continue to next attempt if available
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, `Unexpected status (${response.status})`);
        await delay(delayMs);
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, errorMsg);
        await delay(delayMs);
      }
    }
  }
  
  const duration = Date.now() - startTime;
  trackEnd(opId, false, { duration, error: 'Max retries exceeded' });
  
  return {
    url,
    success: false,
    statusCode: 0,
    contentLength: 0,
    duration,
    retries: events.filter(e => e.id === opId && e.type === 'retry').length,
  };
}

// ============================================================================
// Concurrent Pool Processing (sliding window - always keep maxConcurrency active)
// ============================================================================

async function processWithConcurrencyPool(
  urls: string[],
  apiKey: string,
  maxConcurrency: number = 30
): Promise<ScrapeResult[]> {
  const results: ScrapeResult[] = new Array(urls.length);
  let nextIndex = 0;
  let activeCount = 0;
  let completedCount = 0;
  
  log(`Starting concurrent pool: ${urls.length} URLs, max ${maxConcurrency} concurrent`);
  
  return new Promise((resolve) => {
    const startNext = () => {
      // Start new requests while under concurrency limit and urls remain
      while (activeCount < maxConcurrency && nextIndex < urls.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        activeCount++;
        
        // Start the request (don't await - fire and forget)
        scrapeUrl(urls[currentIndex], apiKey, currentIndex)
          .then((result) => {
            results[currentIndex] = result;
            activeCount--;
            completedCount++;
            
            // Log progress every 10 completions
            if (completedCount % 10 === 0 || completedCount === urls.length) {
              log(`Progress: ${completedCount}/${urls.length} completed, ${activeCount} active`);
            }
            
            // Check if all done
            if (completedCount === urls.length) {
              resolve(results);
            } else {
              // Start next request immediately
              startNext();
            }
          })
          .catch((error) => {
            // Handle unexpected errors
            results[currentIndex] = {
              url: urls[currentIndex],
              success: false,
              statusCode: 0,
              contentLength: 0,
              duration: 0,
              retries: 0,
              error: error instanceof Error ? error.message : String(error),
            };
            activeCount--;
            completedCount++;
            
            if (completedCount === urls.length) {
              resolve(results);
            } else {
              startNext();
            }
          });
      }
    };
    
    // Kick off initial batch
    startNext();
  });
}

// ============================================================================
// Analysis
// ============================================================================

function analyzeParallelism(): void {
  log('\n' + '='.repeat(60));
  log('📊 PARALLELISM ANALYSIS (Sliding Window Pool)');
  log('='.repeat(60));
  
  const startEvents = events.filter(e => e.type === 'start');
  const endEvents = events.filter(e => e.type === 'end');
  const retryEvents = events.filter(e => e.type === 'retry');
  
  if (startEvents.length === 0) {
    log('No events to analyze');
    return;
  }
  
  // Calculate concurrent requests over time
  const allEvents = [...startEvents, ...endEvents].sort((a, b) => a.timestamp - b.timestamp);
  let concurrent = 0;
  let maxConcurrent = 0;
  const concurrencyTimeline: Array<{ time: number; concurrent: number }> = [];
  
  for (const event of allEvents) {
    if (event.type === 'start') {
      concurrent++;
    } else {
      concurrent--;
    }
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    concurrencyTimeline.push({ time: event.timestamp, concurrent });
  }
  
  // Calculate time spread for first 30 starts (initial burst)
  const first30Starts = startEvents.slice(0, 30);
  const initialSpread = first30Starts.length > 1 
    ? first30Starts[first30Starts.length - 1].timestamp - first30Starts[0].timestamp
    : 0;
  
  // Check if new requests started as others completed (sliding window behavior)
  const startTimes = startEvents.map(e => e.timestamp);
  const endTimes = endEvents.map(e => e.timestamp).sort((a, b) => a - b);
  
  // Count how many starts happened after first completion (sliding window indicator)
  const firstCompletion = endTimes[0];
  const startsAfterFirstCompletion = startTimes.filter(t => t > firstCompletion).length;
  
  log(`Total requests: ${startEvents.length}`);
  log(`Initial burst (first 30): ${initialSpread}ms spread`);
  log(`Max concurrent: ${maxConcurrent}`);
  log(`Starts after first completion: ${startsAfterFirstCompletion} (sliding window indicator)`);
  log(`Total retries: ${retryEvents.length}`);
  log(`Rate limit hits (429): ${retryEvents.filter(e => (e.data?.error as string)?.includes('429')).length}`);
  log(`Server errors (502): ${retryEvents.filter(e => (e.data?.error as string)?.includes('502')).length}`);
  
  // Verdict
  if (maxConcurrent >= 28 && startsAfterFirstCompletion > 15) {
    log('\n✅ VERDICT: Excellent sliding window parallelism');
    log('   - Maintained ~30 concurrent requests');
    log('   - New requests started immediately as others completed');
  } else if (maxConcurrent >= 20) {
    log('\n⚠️ VERDICT: Good parallelism but could be better');
  } else {
    log('\n❌ VERDICT: Low parallelism, possible rate limiting or network issues');
  }
  
  // Show timeline (requests active per second)
  log('\n📈 CONCURRENCY TIMELINE (active requests per second):');
  const secondBuckets = new Map<number, number[]>();
  for (const point of concurrencyTimeline) {
    const second = Math.floor(point.time / 1000);
    if (!secondBuckets.has(second)) {
      secondBuckets.set(second, []);
    }
    secondBuckets.get(second)!.push(point.concurrent);
  }
  
  const sortedSeconds = Array.from(secondBuckets.entries()).sort((a, b) => a[0] - b[0]);
  const baseSecond = sortedSeconds[0]?.[0] || 0;
  for (const [second, concurrencies] of sortedSeconds) {
    const avgConcurrency = Math.round(concurrencies.reduce((a, b) => a + b, 0) / concurrencies.length);
    const bar = '█'.repeat(Math.min(avgConcurrency, 40));
    log(`  ${second - baseSecond}s: ${bar} (avg: ${avgConcurrency})`);
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 Scrape Links Parallel Test');
  console.log('📝 Testing 50 URLs with max 30 concurrency');
  console.log('🔢 Number-to-text conversion for IP addresses');
  console.log('🔄 Retry: exponential backoff (2x, max 10s, 20 retries)');
  console.log('='.repeat(60) + '\n');
  
  const apiKey = process.env.SCRAPEDO_API_KEY;
  if (!apiKey) {
    console.error('❌ SCRAPEDO_API_KEY not set');
    process.exit(1);
  }
  
  const urls = generateTestUrls(50);
  log(`Generated ${urls.length} test URLs`);
  
  const startTime = Date.now();
  const results = await processWithConcurrencyPool(urls, apiKey, 30);
  const totalDuration = Date.now() - startTime;
  
  // Results summary
  log('\n' + '='.repeat(60));
  log('📊 RESULTS SUMMARY');
  log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
  const ipsFound = results.filter(r => r.ipFound).length;
  
  log(`Total duration: ${totalDuration}ms`);
  log(`Successful: ${successful}/${results.length}`);
  log(`Failed: ${failed}/${results.length}`);
  log(`Total retries: ${totalRetries}`);
  log(`IPs extracted: ${ipsFound}`);
  
  // Show sample IP conversions
  log('\n📋 SAMPLE IP CONVERSIONS:');
  const sampleResults = results.filter(r => r.ipFound).slice(0, 5);
  for (const result of sampleResults) {
    log(`  ${result.url}`);
    log(`    IP: ${result.ipFound}`);
    log(`    Words: ${result.convertedToWords}`);
  }
  
  analyzeParallelism();
  
  // Save logs
  writeFileSync(LOG_FILE, logs.join('\n'));
  
  const jsonFile = LOG_FILE.replace('.log', '.json');
  writeFileSync(jsonFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { 
      urlCount: urls.length, 
      maxConcurrency: 30, 
      retryConfig: RETRY_CONFIG,
    },
    summary: { 
      totalDuration, 
      successful, 
      failed, 
      totalRetries, 
      ipsFound,
    },
    results,
    events,
  }, null, 2));
  
  console.log(`\n📝 Logs saved to: ${LOG_FILE}`);
  console.log(`📊 JSON saved to: ${jsonFile}`);
}

main().catch(console.error);
