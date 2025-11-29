#!/usr/bin/env tsx
/**
 * Parallel Test Runner for MCP Server
 * Tests parallel execution behavior and rate limiting
 * 
 * Usage: npx tsx tests/parallel-test-runner.ts [test-name]
 * Tests: web-search, reddit-search, scrape-links, deep-research, all
 */

import 'dotenv/config';
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

interface TestConfig {
  name: string;
  tool: string;
  params: Record<string, unknown>;
  expectedConcurrency: number;
  description: string;
}

const LOG_DIR = join(process.cwd(), 'test-logs');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

// ============================================================================
// Test Configurations
// ============================================================================

const WEB_SEARCH_TEST: TestConfig = {
  name: 'web-search',
  tool: 'web_search',
  description: 'Test 30 parallel web searches via Serper API',
  expectedConcurrency: 30,
  params: {
    keywords: [
      // Technology topics
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
      // AI topics
      'openai gpt-4 alternatives',
      'claude anthropic capabilities',
      'llama 2 local deployment',
      'stable diffusion image generation',
      'machine learning frameworks comparison',
      // Development tools
      'best IDE for web development',
      'vscode extensions must have',
      'git workflow best practices',
      'ci cd pipeline setup',
      'terraform infrastructure as code',
      // Web technologies
      'nextjs 14 new features',
      'tailwind css vs bootstrap',
      'graphql vs rest api',
      'websocket real-time applications',
      'serverless architecture pros cons',
      // Cloud & DevOps
      'aws vs azure vs gcp comparison',
      'kubernetes deployment strategies',
      'microservices communication patterns',
      'api gateway best practices',
      'monitoring and observability tools',
    ],
  },
};

const REDDIT_SEARCH_TEST: TestConfig = {
  name: 'reddit-search',
  tool: 'search_reddit',
  description: 'Test 10 parallel Reddit searches via Serper API',
  expectedConcurrency: 10,
  params: {
    queries: [
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
    ],
  },
};

// Generate "what is my IP" style URLs with number conversion prompts
function generateIPCheckUrls(count: number): string[] {
  const urls: string[] = [];
  const ipServices = [
    'https://api.ipify.org',
    'https://icanhazip.com',
    'https://ifconfig.me/ip',
    'https://checkip.amazonaws.com',
    'https://ipecho.net/plain',
    'https://ipinfo.io/ip',
    'https://myexternalip.com/raw',
    'https://wtfismyip.com/text',
    'https://ident.me',
    'https://v4.ident.me',
  ];

  // Add variations with httpbin and other services
  const additionalUrls = [
    'https://httpbin.org/ip',
    'https://httpbin.org/headers',
    'https://httpbin.org/user-agent',
    'https://api.myip.com',
    'https://ip.seeip.org',
    'https://api64.ipify.org',
    'https://ipv4.icanhazip.com',
    'https://checkip.dyndns.org',
  ];

  // Cycle through available URLs to reach count
  for (let i = 0; i < count; i++) {
    const allUrls = [...ipServices, ...additionalUrls];
    urls.push(allUrls[i % allUrls.length]);
  }

  return urls;
}

// Number to words conversion for prompts
function numberToWords(n: number): string {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
                'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
  
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
}

const SCRAPE_LINKS_TEST: TestConfig = {
  name: 'scrape-links',
  tool: 'scrape_links',
  description: 'Test 50 parallel URL scrapes (max 30 concurrency) with IP check style prompts',
  expectedConcurrency: 30,
  params: {
    urls: generateIPCheckUrls(50),
    use_llm: true,
    what_to_extract: 
      `Extract the IP address shown on this page. ` +
      `Convert any numbers you find to their written word form. ` +
      `For example, if the IP is "192.168.1.1", convert it to ` +
      `"one hundred ninety-two dot one hundred sixty-eight dot one dot one". ` +
      `Also note if the page shows any other information like location or ISP.`,
    timeout: 30,
  },
};

// Generate capital city questions
function generateCapitalCityQuestions(): Array<{ question: string }> {
  const countries = [
    'United States', 'United Kingdom', 'Japan', 'Germany', 'France',
    'Brazil', 'Australia', 'India', 'China', 'Canada'
  ];
  
  return countries.map((country, i) => ({
    question: `What is the capital city of ${country}? ` +
      `Please provide: (${numberToWords(i + 1)}) the capital name, ` +
      `(${numberToWords(i + 2)}) population estimate, ` +
      `(${numberToWords(i + 3)}) notable landmarks. ` +
      `Keep response under ${numberToWords(20)} sentences.`,
  }));
}

const DEEP_RESEARCH_TEST: TestConfig = {
  name: 'deep-research',
  tool: 'deep_research',
  description: 'Test 10 parallel deep research queries (capital cities)',
  expectedConcurrency: 10,
  params: {
    questions: generateCapitalCityQuestions(),
  },
};

const ALL_TESTS: TestConfig[] = [
  WEB_SEARCH_TEST,
  REDDIT_SEARCH_TEST,
  SCRAPE_LINKS_TEST,
  DEEP_RESEARCH_TEST,
];

// ============================================================================
// Logging Utilities
// ============================================================================

interface LogEntry {
  timestamp: string;
  type: 'start' | 'end' | 'error' | 'info' | 'parallel' | 'retry';
  message: string;
  data?: unknown;
}

class TestLogger {
  private logs: LogEntry[] = [];
  private startTimes: Map<string, number> = new Map();
  private parallelTracker: Map<string, number[]> = new Map();

  constructor(private testName: string) {}

  log(type: LogEntry['type'], message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      data,
    };
    this.logs.push(entry);
    
    const prefix = `[${entry.timestamp}] [${type.toUpperCase()}]`;
    console.log(`${prefix} ${message}`);
    if (data) {
      console.log(`${prefix} Data:`, JSON.stringify(data, null, 2));
    }
  }

  startOperation(opId: string): void {
    const now = Date.now();
    this.startTimes.set(opId, now);
    this.log('start', `Operation ${opId} started`);

    // Track parallel operations
    const second = Math.floor(now / 1000);
    const key = `second-${second}`;
    if (!this.parallelTracker.has(key)) {
      this.parallelTracker.set(key, []);
    }
    this.parallelTracker.get(key)!.push(now);
  }

  endOperation(opId: string, success: boolean, result?: unknown): void {
    const startTime = this.startTimes.get(opId);
    const duration = startTime ? Date.now() - startTime : 0;
    this.log('end', `Operation ${opId} ${success ? 'succeeded' : 'failed'} in ${duration}ms`, result);
  }

  logRetry(opId: string, attempt: number, delay: number, error: string): void {
    this.log('retry', `Operation ${opId} retry ${attempt}, waiting ${delay}ms: ${error}`);
  }

  getParallelismStats(): { maxConcurrent: number; avgConcurrent: number; timeline: Array<{ second: number; count: number }> } {
    const timeline = Array.from(this.parallelTracker.entries())
      .map(([key, times]) => ({
        second: parseInt(key.replace('second-', '')),
        count: times.length,
      }))
      .sort((a, b) => a.second - b.second);

    const counts = timeline.map(t => t.count);
    const maxConcurrent = Math.max(...counts, 0);
    const avgConcurrent = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

    return { maxConcurrent, avgConcurrent, timeline };
  }

  saveToFile(filepath: string): void {
    const output = {
      testName: this.testName,
      timestamp: new Date().toISOString(),
      parallelismStats: this.getParallelismStats(),
      logs: this.logs,
    };
    writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`\n📝 Logs saved to: ${filepath}`);
  }
}

// ============================================================================
// MCP Client
// ============================================================================

async function callMCPTool(
  toolName: string,
  params: Record<string, unknown>,
  logger: TestLogger
): Promise<{ success: boolean; result?: unknown; error?: string; duration: number }> {
  const startTime = Date.now();
  const opId = `${toolName}-${Date.now()}`;
  
  logger.startOperation(opId);

  return new Promise((resolve) => {
    const mcpProcess = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    mcpProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    mcpProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log rate limit retries
      if (data.toString().includes('429') || data.toString().includes('rate limit')) {
        logger.log('retry', `Rate limit detected in stderr: ${data.toString().trim()}`);
      }
    });

    // Send MCP request
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params,
      },
    };

    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
    mcpProcess.stdin.end();

    const timeout = setTimeout(() => {
      mcpProcess.kill();
      logger.endOperation(opId, false, { error: 'Timeout' });
      resolve({
        success: false,
        error: 'Operation timed out after 5 minutes',
        duration: Date.now() - startTime,
      });
    }, 5 * 60 * 1000); // 5 minute timeout

    mcpProcess.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      try {
        // Try to parse JSON response from stdout
        const lines = stdout.split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];
        
        if (lastLine) {
          const response = JSON.parse(lastLine);
          logger.endOperation(opId, true, { contentLength: response?.result?.content?.[0]?.text?.length });
          resolve({ success: true, result: response, duration });
        } else {
          logger.endOperation(opId, false, { stderr: stderr.substring(0, 500) });
          resolve({ success: false, error: `No response. Stderr: ${stderr.substring(0, 500)}`, duration });
        }
      } catch (e) {
        logger.endOperation(opId, false, { parseError: String(e), stdout: stdout.substring(0, 500) });
        resolve({
          success: false,
          error: `Failed to parse response: ${e}`,
          duration,
        });
      }
    });

    mcpProcess.on('error', (err) => {
      clearTimeout(timeout);
      logger.endOperation(opId, false, { error: err.message });
      resolve({
        success: false,
        error: `Process error: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

// ============================================================================
// Direct API Testing (bypassing MCP for more control)
// ============================================================================

async function testWebSearchDirectly(config: TestConfig, logger: TestLogger): Promise<void> {
  logger.log('info', `Starting direct test: ${config.name}`);
  logger.log('info', `Parameters: ${JSON.stringify(config.params, null, 2)}`);

  // Dynamically import the search module
  const { SearchClient } = await import('../src/clients/search.js');
  
  const client = new SearchClient();
  const keywords = config.params.keywords as string[];

  logger.log('info', `Testing ${keywords.length} keywords...`);

  const startTime = Date.now();
  
  // Track when each request starts
  const requestStarts: number[] = [];
  const results: Array<{ keyword: string; success: boolean; results: number; startTime: number; endTime: number }> = [];

  // Use Promise.all to test actual parallelism
  await Promise.all(
    keywords.map(async (keyword, index) => {
      const reqStart = Date.now();
      requestStarts.push(reqStart);
      logger.startOperation(`search-${index}-${keyword.substring(0, 20)}`);
      
      try {
        const response = await client.searchMultiple([keyword]);
        const endTime = Date.now();
        
        results.push({
          keyword,
          success: true,
          results: response.searches[0]?.results?.length || 0,
          startTime: reqStart,
          endTime,
        });
        
        logger.endOperation(`search-${index}-${keyword.substring(0, 20)}`, true, {
          results: response.searches[0]?.results?.length || 0,
          duration: endTime - reqStart,
        });
      } catch (error) {
        const endTime = Date.now();
        results.push({
          keyword,
          success: false,
          results: 0,
          startTime: reqStart,
          endTime,
        });
        
        logger.endOperation(`search-${index}-${keyword.substring(0, 20)}`, false, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  const totalDuration = Date.now() - startTime;
  
  // Analyze parallelism
  const startTimes = requestStarts.sort((a, b) => a - b);
  const firstStart = startTimes[0];
  const lastStart = startTimes[startTimes.length - 1];
  const startSpread = lastStart - firstStart;

  logger.log('info', `\n📊 PARALLELISM ANALYSIS:`);
  logger.log('info', `Total duration: ${totalDuration}ms`);
  logger.log('info', `First request start: ${firstStart - firstStart}ms (relative)`);
  logger.log('info', `Last request start: ${lastStart - firstStart}ms (relative)`);
  logger.log('info', `Start spread: ${startSpread}ms`);
  logger.log('info', `If parallel: spread should be < 100ms. If sequential: spread ~= total duration`);
  logger.log('info', `Verdict: ${startSpread < 100 ? '✅ PARALLEL' : startSpread < totalDuration / 2 ? '⚠️ PARTIALLY PARALLEL' : '❌ SEQUENTIAL'}`);

  const successful = results.filter(r => r.success).length;
  logger.log('info', `\n📈 RESULTS:`);
  logger.log('info', `Successful: ${successful}/${results.length}`);
  logger.log('info', `Failed: ${results.length - successful}/${results.length}`);
}

async function testScrapingDirectly(config: TestConfig, logger: TestLogger): Promise<void> {
  logger.log('info', `Starting direct test: ${config.name}`);
  logger.log('info', `Parameters: ${JSON.stringify(config.params, null, 2)}`);

  // Dynamically import the scraper module
  const { ScraperClient } = await import('../src/clients/scraper.js');
  
  const client = new ScraperClient();
  const urls = config.params.urls as string[];

  logger.log('info', `Testing ${urls.length} URLs with max 30 concurrency...`);

  const startTime = Date.now();
  const requestStarts: number[] = [];
  const results: Array<{ url: string; success: boolean; startTime: number; endTime: number }> = [];

  // Process in batches of 30 (max concurrency)
  const batchSize = 30;
  const batches: string[][] = [];
  
  for (let i = 0; i < urls.length; i += batchSize) {
    batches.push(urls.slice(i, i + batchSize));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    logger.log('info', `Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} URLs)`);

    const batchResults = await Promise.all(
      batch.map(async (url, localIdx) => {
        const globalIdx = batchIdx * batchSize + localIdx;
        const reqStart = Date.now();
        requestStarts.push(reqStart);
        logger.startOperation(`scrape-${globalIdx}-${url}`);

        try {
          const response = await client.scrapeWithFallback(url, { timeout: 30 });
          const endTime = Date.now();

          logger.endOperation(`scrape-${globalIdx}-${url}`, true, {
            status: response.statusCode,
            contentLength: response.content?.length || 0,
            duration: endTime - reqStart,
          });

          return { url, success: true, startTime: reqStart, endTime };
        } catch (error) {
          const endTime = Date.now();
          logger.endOperation(`scrape-${globalIdx}-${url}`, false, {
            error: error instanceof Error ? error.message : String(error),
          });
          return { url, success: false, startTime: reqStart, endTime };
        }
      })
    );

    results.push(...batchResults);

    // Small delay between batches
    if (batchIdx < batches.length - 1) {
      logger.log('info', `Waiting 500ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const totalDuration = Date.now() - startTime;

  // Analyze parallelism per batch
  logger.log('info', `\n📊 PARALLELISM ANALYSIS:`);
  logger.log('info', `Total duration: ${totalDuration}ms`);
  logger.log('info', `Batches processed: ${batches.length}`);
  
  const successful = results.filter(r => r.success).length;
  logger.log('info', `\n📈 RESULTS:`);
  logger.log('info', `Successful: ${successful}/${results.length}`);
  logger.log('info', `Failed: ${results.length - successful}/${results.length}`);
}

async function testDeepResearchDirectly(config: TestConfig, logger: TestLogger): Promise<void> {
  logger.log('info', `Starting direct test: ${config.name}`);
  logger.log('info', `Parameters: ${JSON.stringify(config.params, null, 2)}`);

  // Dynamically import the research module
  const { handleDeepResearch } = await import('../src/tools/research.js');
  
  const questions = config.params.questions as Array<{ question: string }>;

  logger.log('info', `Testing ${questions.length} research questions in parallel...`);

  const startTime = Date.now();

  try {
    const result = await handleDeepResearch({ questions });
    const totalDuration = Date.now() - startTime;

    logger.log('info', `\n📊 DEEP RESEARCH RESULTS:`);
    logger.log('info', `Total duration: ${totalDuration}ms`);
    logger.log('info', `Content length: ${result.content.length} characters`);
    logger.log('info', `Structured content:`, result.structuredContent);
  } catch (error) {
    logger.log('error', `Deep research failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runTest(config: TestConfig): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TEST: ${config.name}`);
  console.log(`📝 ${config.description}`);
  console.log(`🔢 Expected concurrency: ${config.expectedConcurrency}`);
  console.log(`${'='.repeat(60)}\n`);

  const logger = new TestLogger(config.name);
  const logFile = join(LOG_DIR, `${config.name}-${TIMESTAMP}.json`);

  try {
    // Use direct testing for better parallelism analysis
    if (config.name === 'web-search' || config.name === 'reddit-search') {
      await testWebSearchDirectly(config, logger);
    } else if (config.name === 'scrape-links') {
      await testScrapingDirectly(config, logger);
    } else if (config.name === 'deep-research') {
      await testDeepResearchDirectly(config, logger);
    } else {
      // Fallback to MCP call
      const result = await callMCPTool(config.tool, config.params, logger);
      logger.log('info', `MCP call completed`, result);
    }
  } catch (error) {
    logger.log('error', `Test failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Save logs
  logger.saveToFile(logFile);

  // Print parallelism summary
  const stats = logger.getParallelismStats();
  console.log(`\n📊 PARALLELISM SUMMARY:`);
  console.log(`   Max concurrent: ${stats.maxConcurrent}`);
  console.log(`   Avg concurrent: ${stats.avgConcurrent.toFixed(2)}`);
  console.log(`   Expected: ${config.expectedConcurrency}`);
  console.log(`   Verdict: ${stats.maxConcurrent >= config.expectedConcurrency * 0.5 ? '✅ Good parallelism' : '⚠️ Low parallelism'}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const testName = args[0] || 'all';

  console.log(`\n🚀 MCP Parallel Test Runner`);
  console.log(`📁 Log directory: ${LOG_DIR}`);
  console.log(`⏰ Timestamp: ${TIMESTAMP}`);

  if (testName === 'all') {
    console.log(`\n📋 Running all tests...`);
    for (const config of ALL_TESTS) {
      await runTest(config);
    }
  } else {
    const config = ALL_TESTS.find(t => t.name === testName);
    if (!config) {
      console.error(`❌ Unknown test: ${testName}`);
      console.error(`Available tests: ${ALL_TESTS.map(t => t.name).join(', ')}, all`);
      process.exit(1);
    }
    await runTest(config);
  }

  console.log(`\n✅ All tests completed. Check ${LOG_DIR} for detailed logs.`);
}

main().catch(console.error);
