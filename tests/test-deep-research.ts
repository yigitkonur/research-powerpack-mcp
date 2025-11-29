#!/usr/bin/env tsx
/**
 * Deep Research Parallel Test
 * Tests 10 capital city questions in parallel
 * Uses OpenRouter API with perplexity/sonar-deep-research model
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import OpenAI from 'openai';

// Setup
const LOG_DIR = join(process.cwd(), 'test-logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = join(LOG_DIR, `deep-research-${TIMESTAMP}.log`);

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
  
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
  return ones[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
}

// ============================================================================
// Question Generation
// ============================================================================

interface ResearchQuestion {
  country: string;
  question: string;
}

function generateCapitalCityQuestions(): ResearchQuestion[] {
  const countries = [
    'United States',
    'United Kingdom', 
    'Japan',
    'Germany',
    'France',
    'Brazil',
    'Australia',
    'India',
    'China',
    'Canada',
  ];
  
  return countries.map((country, i) => ({
    country,
    question: `What is the capital city of ${country}? ` +
      `Provide (${numberToWords(i + 1)}) the capital name, ` +
      `(${numberToWords(i + 2)}) current population estimate, ` +
      `(${numberToWords(i + 3)}) three notable landmarks or attractions. ` +
      `Keep response concise, under ${numberToWords(15)} sentences total.`,
  }));
}

// ============================================================================
// Research Function with Retry
// ============================================================================

interface ResearchResult {
  country: string;
  question: string;
  success: boolean;
  response: string;
  duration: number;
  retries: number;
  tokensUsed?: number;
}

async function researchQuestion(
  question: ResearchQuestion,
  client: OpenAI,
  index: number
): Promise<ResearchResult> {
  const opId = `research-${index}-${question.country}`;
  const startTime = Date.now();
  
  trackStart(opId);
  
  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: process.env.RESEARCH_MODEL || 'perplexity/sonar-deep-research',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful research assistant. Provide accurate, concise information.',
          },
          {
            role: 'user',
            content: question.question,
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      } as any);
      
      const content = response.choices?.[0]?.message?.content || '';
      const tokensUsed = response.usage?.total_tokens;
      const duration = Date.now() - startTime;
      
      trackEnd(opId, true, { 
        tokensUsed, 
        responseLength: content.length,
        duration,
      });
      
      return {
        country: question.country,
        question: question.question,
        success: true,
        response: content,
        duration,
        retries: events.filter(e => e.id === opId && e.type === 'retry').length,
        tokensUsed,
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Check for rate limiting
      const isRateLimit = errorMsg.includes('429') || 
                          errorMsg.toLowerCase().includes('rate limit') ||
                          errorMsg.toLowerCase().includes('too many requests');
      
      if (isRateLimit && attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, errorMsg);
        await delay(delayMs);
        continue;
      }
      
      // For other errors, still try retry
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = calculateDelay(attempt);
        trackRetry(opId, attempt + 1, delayMs, errorMsg);
        await delay(delayMs);
        continue;
      }
      
      const duration = Date.now() - startTime;
      trackEnd(opId, false, { error: errorMsg, duration });
      
      return {
        country: question.country,
        question: question.question,
        success: false,
        response: `Error: ${errorMsg}`,
        duration,
        retries: events.filter(e => e.id === opId && e.type === 'retry').length,
      };
    }
  }
  
  // Should not reach here
  const duration = Date.now() - startTime;
  trackEnd(opId, false, { error: 'Max retries exceeded', duration });
  
  return {
    country: question.country,
    question: question.question,
    success: false,
    response: 'Error: Max retries exceeded',
    duration,
    retries: RETRY_CONFIG.maxRetries,
  };
}

// ============================================================================
// Analysis
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
  
  // Calculate average/min/max duration
  const durations = endEvents
    .map(e => e.data?.duration as number)
    .filter(d => typeof d === 'number');
  
  if (durations.length > 0) {
    log(`\nDuration stats:`);
    log(`  Min: ${Math.min(...durations)}ms`);
    log(`  Max: ${Math.max(...durations)}ms`);
    log(`  Avg: ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)}ms`);
  }
  
  // Verdict
  if (startSpread < 100) {
    log('\n✅ VERDICT: All requests started nearly simultaneously (parallel)');
  } else if (startSpread < 1000) {
    log('\n⚠️ VERDICT: Slight staggering but mostly parallel');
  } else {
    log('\n❌ VERDICT: Requests were sequential or heavily rate-limited');
  }
  
  // Timeline visualization
  log('\n📈 TIMELINE (requests started per second):');
  const sortedSeconds = Array.from(secondBuckets.entries()).sort((a, b) => a[0] - b[0]);
  const baseSecond = sortedSeconds[0]?.[0] || 0;
  for (const [second, count] of sortedSeconds) {
    const bar = '█'.repeat(count);
    log(`  ${second - baseSecond}s: ${bar} (${count})`);
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function main(): Promise<void> {
  console.log('\n🚀 Deep Research Parallel Test');
  console.log('📝 Testing 10 capital city questions in parallel');
  console.log('🔄 Retry: exponential backoff (2x, max 10s, 20 retries)');
  console.log('='.repeat(60) + '\n');
  
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not set');
    process.exit(1);
  }
  
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const model = process.env.RESEARCH_MODEL || 'perplexity/sonar-deep-research';
  
  log(`API Base URL: ${baseUrl}`);
  log(`Model: ${model}`);
  
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
  });
  
  const questions = generateCapitalCityQuestions();
  log(`Generated ${questions.length} research questions`);
  
  const startTime = Date.now();
  
  // Execute all research in parallel
  const results = await Promise.all(
    questions.map((q, i) => researchQuestion(q, client, i))
  );
  
  const totalDuration = Date.now() - startTime;
  
  // Results summary
  log('\n' + '='.repeat(60));
  log('📊 RESULTS SUMMARY');
  log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
  const totalTokens = results.reduce((sum, r) => sum + (r.tokensUsed || 0), 0);
  
  log(`Total duration: ${totalDuration}ms`);
  log(`Successful: ${successful}/${results.length}`);
  log(`Failed: ${failed}/${results.length}`);
  log(`Total retries: ${totalRetries}`);
  log(`Total tokens used: ${totalTokens}`);
  
  // Show sample responses
  log('\n📋 SAMPLE RESPONSES:');
  for (const result of results.filter(r => r.success).slice(0, 3)) {
    log(`\n  Country: ${result.country}`);
    log(`  Duration: ${result.duration}ms`);
    log(`  Tokens: ${result.tokensUsed || 'N/A'}`);
    log(`  Response preview: ${result.response.substring(0, 150)}...`);
  }
  
  analyzeParallelism();
  
  // Save logs
  writeFileSync(LOG_FILE, logs.join('\n'));
  
  const jsonFile = LOG_FILE.replace('.log', '.json');
  writeFileSync(jsonFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { 
      questionCount: questions.length, 
      model,
      retryConfig: RETRY_CONFIG,
    },
    summary: { 
      totalDuration, 
      successful, 
      failed, 
      totalRetries,
      totalTokens,
    },
    results: results.map(r => ({
      ...r,
      response: r.response.substring(0, 500) + (r.response.length > 500 ? '...' : ''),
    })),
    events,
  }, null, 2));
  
  console.log(`\n📝 Logs saved to: ${LOG_FILE}`);
  console.log(`📊 JSON saved to: ${jsonFile}`);
}

main().catch(console.error);
