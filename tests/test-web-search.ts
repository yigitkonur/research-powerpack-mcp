#!/usr/bin/env tsx
/**
 * Web Search Parallel Test
 * Tests 30 keywords in parallel with proper rate limiting
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Setup
const LOG_DIR = join(process.cwd(), 'test-logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `web-search-${TIMESTAMP}.log`);

// ============================================================================
// Enhanced Logger with Parallel Tracking
// ============================================================================

interface ParallelEvent {
  timestamp: number;
  id: string;
  type: 'start' | 'end' | 'retry';
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
  log(`RETRY: ${id} attempt ${attempt}, waiting ${delay}ms`, { error });
}

// ============================================================================
// Retry Logic (exponential backoff: 2x, max 10s, 20 retries)
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

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  opId: string
): Promise<Response> {
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, `Rate limited (429)`);
        await delay(delayMs);
        continue;
      }
      
      if (!response.ok && attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, `HTTP ${response.status}`);
        await delay(delayMs);
        continue;
      }
      
      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, errorMsg);
        await delay(delayMs);
      } else {
        throw error;
      }
    }
  }
  
  throw new Error(`Failed after ${RETRY_CONFIG.maxRetries} retries`);
}

// ============================================================================
// Search Function
// ============================================================================

interface SearchResult {
  keyword: string;
  success: boolean;
  results: number;
  duration: number;
  retries: number;
}

async function searchKeyword(keyword: string, apiKey: string, index: number): Promise<SearchResult> {
  const opId = `search-${index}-${keyword.substring(0, 25)}`;
  const startTime = Date.now();
  
  trackStart(opId);
  
  try {
    const response = await fetchWithRetry(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: keyword }),
      },
      opId
    );
    
    const data = await response.json() as { organic?: unknown[] };
    const resultCount = data.organic?.length || 0;
    const duration = Date.now() - startTime;
    
    trackEnd(opId, true, { results: resultCount, duration });
    
    return {
      keyword,
      success: true,
      results: resultCount,
      duration,
      retries: events.filter(e => e.id === opId && e.type === 'retry').length,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    trackEnd(opId, false, { error: errorMsg, duration });
    
    return {
      keyword,
      success: false,
      results: 0,
      duration,
      retries: events.filter(e => e.id === opId && e.type === 'retry').length,
    };
  }
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeParallelism(): void {
  log('\n' + '='.repeat(60));
  log('📊 PARALLELISM ANALYSIS');
  log('='.repeat(60));
  
  const startEvents = events.filter(e => e.type === 'start');
  const endEvents = events.filter(e => e.type === 'end');
  const retryEvents = events.filter(e => e.type === 'retry');
  
  if (startEvents.length === 0) {
    log('No events to analyze');
    return;
  }
  
  // Calculate time spread
  const startTimes = startEvents.map(e => e.timestamp).sort((a, b) => a - b);
  const firstStart = startTimes[0];
  const lastStart = startTimes[startTimes.length - 1];
  const startSpread = lastStart - firstStart;
  
  // Calculate concurrent operations per second
  const secondBuckets = new Map<number, number>();
  for (const event of startEvents) {
    const second = Math.floor(event.timestamp / 1000);
    secondBuckets.set(second, (secondBuckets.get(second) || 0) + 1);
  }
  
  const maxConcurrent = Math.max(...Array.from(secondBuckets.values()));
  const avgConcurrent = Array.from(secondBuckets.values()).reduce((a, b) => a + b, 0) / secondBuckets.size;
  
  log(`Total operations: ${startEvents.length}`);
  log(`Start time spread: ${startSpread}ms`);
  log(`Max concurrent (per second): ${maxConcurrent}`);
  log(`Avg concurrent (per second): ${avgConcurrent.toFixed(2)}`);
  log(`Total retries: ${retryEvents.length}`);
  log(`Rate limit hits: ${retryEvents.filter(e => (e.data?.error as string)?.includes('429')).length}`);
  
  // Verdict
  if (startSpread < 100) {
    log('✅ VERDICT: Requests started nearly simultaneously (parallel)');
  } else if (startSpread < 1000) {
    log('⚠️ VERDICT: Slight staggering but mostly parallel');
  } else {
    log('❌ VERDICT: Requests were sequential or heavily rate-limited');
  }
  
  // Timeline visualization
  log('\n📈 TIMELINE (requests per second):');
  const sortedSeconds = Array.from(secondBuckets.entries()).sort((a, b) => a[0] - b[0]);
  for (const [second, count] of sortedSeconds) {
    const bar = '█'.repeat(count);
    log(`  ${second - sortedSeconds[0][0]}s: ${bar} (${count})`);
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 Web Search Parallel Test');
  console.log('📝 Testing 30 keywords in parallel');
  console.log('🔄 Retry: exponential backoff (2x, max 10s, 20 retries)');
  console.log('='.repeat(60) + '\n');
  
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error('❌ SERPER_API_KEY not set');
    process.exit(1);
  }
  
  const keywords = [
    'best programming languages 2024',
    'javascript vs typescript comparison',
    'react vs vue vs angular 2024',
    'nodejs performance optimization',
    'python machine learning libraries',
    'rust programming advantages',
    'golang microservices architecture',
    'docker kubernetes tutorial',
    'postgresql vs mysql performance',
    'redis caching best practices',
    'openai gpt-4 alternatives',
    'claude anthropic capabilities',
    'llama 2 local deployment',
    'stable diffusion image generation',
    'machine learning frameworks comparison',
    'best IDE for web development',
    'vscode extensions must have',
    'git workflow best practices',
    'ci cd pipeline setup',
    'terraform infrastructure as code',
    'nextjs 14 new features',
    'tailwind css vs bootstrap',
    'graphql vs rest api',
    'websocket real-time applications',
    'serverless architecture pros cons',
    'aws vs azure vs gcp comparison',
    'kubernetes deployment strategies',
    'microservices communication patterns',
    'api gateway best practices',
    'monitoring and observability tools',
  ];
  
  log(`Starting ${keywords.length} parallel searches...`);
  const startTime = Date.now();
  
  // Execute all searches in parallel
  const results = await Promise.all(
    keywords.map((keyword, index) => searchKeyword(keyword, apiKey, index))
  );
  
  const totalDuration = Date.now() - startTime;
  
  // Results summary
  log('\n' + '='.repeat(60));
  log('📊 RESULTS SUMMARY');
  log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalResults = results.reduce((sum, r) => sum + r.results, 0);
  const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
  
  log(`Total duration: ${totalDuration}ms`);
  log(`Successful: ${successful}/${results.length}`);
  log(`Failed: ${failed}/${results.length}`);
  log(`Total search results: ${totalResults}`);
  log(`Total retries: ${totalRetries}`);
  
  // Analyze parallelism
  analyzeParallelism();
  
  // Save logs
  writeFileSync(LOG_FILE, logs.join('\n'));
  
  // Save detailed JSON
  const jsonFile = LOG_FILE.replace('.log', '.json');
  writeFileSync(jsonFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: {
      keywords: keywords.length,
      retryConfig: RETRY_CONFIG,
    },
    summary: {
      totalDuration,
      successful,
      failed,
      totalResults,
      totalRetries,
    },
    results,
    events,
  }, null, 2));
  
  console.log(`\n📝 Logs saved to: ${LOG_FILE}`);
  console.log(`📊 JSON saved to: ${jsonFile}`);
}

main().catch(console.error);
