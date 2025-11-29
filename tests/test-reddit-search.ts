#!/usr/bin/env tsx
/**
 * Reddit Search Parallel Test
 * Tests 10 queries in parallel with proper rate limiting
 * Same retry logic as web search (exponential backoff: 2x, max 10s, 20 retries)
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Setup
const LOG_DIR = join(process.cwd(), 'test-logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `reddit-search-${TIMESTAMP}.log`);

// ============================================================================
// Logger & Tracking
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
  log(`RETRY: ${id} attempt ${attempt}, waiting ${delay}ms`, { error: error.substring(0, 100) });
}

// ============================================================================
// Retry Logic (same as Serper: 2x, max 10s, 20 retries)
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
// Reddit Search Function
// ============================================================================

interface SearchResult {
  query: string;
  success: boolean;
  results: number;
  duration: number;
  retries: number;
  posts: Array<{ title: string; url: string; snippet: string }>;
}

async function searchReddit(query: string, apiKey: string, index: number): Promise<SearchResult> {
  const opId = `reddit-${index}-${query.substring(0, 25)}`;
  const startTime = Date.now();
  
  trackStart(opId);
  
  // Add site:reddit.com if not present
  const fullQuery = /site:\s*reddit\.com/i.test(query) ? query : `${query} site:reddit.com`;
  
  try {
    const response = await fetchWithRetry(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: fullQuery, num: 10 }),
      },
      opId
    );
    
    const data = await response.json() as { 
      organic?: Array<{ title: string; link: string; snippet: string }> 
    };
    
    const posts = (data.organic || []).map(r => ({
      title: r.title.replace(/ : r\/\w+$/, '').replace(/ - Reddit$/, ''),
      url: r.link,
      snippet: r.snippet,
    }));
    
    const duration = Date.now() - startTime;
    
    trackEnd(opId, true, { results: posts.length, duration });
    
    return {
      query,
      success: true,
      results: posts.length,
      duration,
      retries: events.filter(e => e.id === opId && e.type === 'retry').length,
      posts,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    trackEnd(opId, false, { error: errorMsg, duration });
    
    return {
      query,
      success: false,
      results: 0,
      duration,
      retries: events.filter(e => e.id === opId && e.type === 'retry').length,
      posts: [],
    };
  }
}

// ============================================================================
// Analysis
// ============================================================================

function analyzeParallelism(): void {
  log('\n' + '='.repeat(60));
  log('📊 PARALLELISM ANALYSIS');
  log('='.repeat(60));
  
  const startEvents = events.filter(e => e.type === 'start');
  const retryEvents = events.filter(e => e.type === 'retry');
  
  if (startEvents.length === 0) {
    log('No events to analyze');
    return;
  }
  
  const startTimes = startEvents.map(e => e.timestamp).sort((a, b) => a - b);
  const startSpread = startTimes[startTimes.length - 1] - startTimes[0];
  
  const secondBuckets = new Map<number, number>();
  for (const event of startEvents) {
    const second = Math.floor(event.timestamp / 1000);
    secondBuckets.set(second, (secondBuckets.get(second) || 0) + 1);
  }
  
  const maxConcurrent = Math.max(...Array.from(secondBuckets.values()));
  
  log(`Total operations: ${startEvents.length}`);
  log(`Start time spread: ${startSpread}ms`);
  log(`Max concurrent (per second): ${maxConcurrent}`);
  log(`Total retries: ${retryEvents.length}`);
  log(`Rate limit hits: ${retryEvents.filter(e => (e.data?.error as string)?.includes('429')).length}`);
  
  if (startSpread < 50) {
    log('✅ VERDICT: All requests started simultaneously (parallel)');
  } else if (startSpread < 500) {
    log('⚠️ VERDICT: Slight staggering but mostly parallel');
  } else {
    log('❌ VERDICT: Requests were sequential or rate-limited');
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 Reddit Search Parallel Test');
  console.log('📝 Testing 10 queries in parallel');
  console.log('🔄 Retry: exponential backoff (2x, max 10s, 20 retries)');
  console.log('='.repeat(60) + '\n');
  
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error('❌ SERPER_API_KEY not set');
    process.exit(1);
  }
  
  const queries = [
    'best IDE for programming 2024',
    'intitle:cursor ai vs github copilot',
    'top python libraries data science',
    'react native vs flutter comparison',
    'best cloud provider for startups',
    'kubernetes learning path beginner',
    'intitle:typescript vs javascript pros cons',
    'best free API development tools',
    'docker compose best practices',
    'graphql vs rest which is better',
  ];
  
  log(`Starting ${queries.length} parallel Reddit searches...`);
  const startTime = Date.now();
  
  // Execute all searches in parallel
  const results = await Promise.all(
    queries.map((query, index) => searchReddit(query, apiKey, index))
  );
  
  const totalDuration = Date.now() - startTime;
  
  // Results summary
  log('\n' + '='.repeat(60));
  log('📊 RESULTS SUMMARY');
  log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const totalResults = results.reduce((sum, r) => sum + r.results, 0);
  const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
  
  log(`Total duration: ${totalDuration}ms`);
  log(`Successful: ${successful}/${results.length}`);
  log(`Total Reddit posts found: ${totalResults}`);
  log(`Total retries: ${totalRetries}`);
  
  // Show sample results
  log('\n📋 SAMPLE RESULTS:');
  for (const result of results.slice(0, 3)) {
    log(`\n  Query: "${result.query}"`);
    log(`  Found: ${result.results} posts, Duration: ${result.duration}ms`);
    if (result.posts.length > 0) {
      log(`  Top post: ${result.posts[0].title.substring(0, 60)}...`);
    }
  }
  
  analyzeParallelism();
  
  // Save logs
  writeFileSync(LOG_FILE, logs.join('\n'));
  
  const jsonFile = LOG_FILE.replace('.log', '.json');
  writeFileSync(jsonFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { queries: queries.length, retryConfig: RETRY_CONFIG },
    summary: { totalDuration, successful, totalResults, totalRetries },
    results,
    events,
  }, null, 2));
  
  console.log(`\n📝 Logs saved to: ${LOG_FILE}`);
  console.log(`📊 JSON saved to: ${jsonFile}`);
}

main().catch(console.error);
