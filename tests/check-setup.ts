#!/usr/bin/env tsx
/**
 * Setup Check Script
 * Verifies that all required API keys are configured
 */

import 'dotenv/config';

console.log('\n🔍 Checking API Key Configuration...\n');
console.log('=' .repeat(50));

interface KeyCheck {
  name: string;
  envVar: string;
  required: string[];
}

const keys: KeyCheck[] = [
  { name: 'Serper (Web Search)', envVar: 'SERPER_API_KEY', required: ['test:web-search', 'test:reddit-search'] },
  { name: 'Scrape.do (Scraping)', envVar: 'SCRAPEDO_API_KEY', required: ['test:scrape-links'] },
  { name: 'OpenRouter (Deep Research)', envVar: 'OPENROUTER_API_KEY', required: ['test:deep-research'] },
];

let allSet = true;
const testsAvailable: string[] = [];
const testsMissing: string[] = [];

for (const key of keys) {
  const value = process.env[key.envVar];
  const isSet = !!value && value.length > 0;
  
  const status = isSet ? '✅' : '❌';
  const masked = isSet ? `${value.substring(0, 8)}...` : 'NOT SET';
  
  console.log(`${status} ${key.name}`);
  console.log(`   ENV: ${key.envVar}`);
  console.log(`   Value: ${masked}`);
  console.log(`   Tests: ${key.required.join(', ')}\n`);
  
  if (isSet) {
    testsAvailable.push(...key.required);
  } else {
    testsMissing.push(...key.required);
    allSet = false;
  }
}

console.log('=' .repeat(50));

if (allSet) {
  console.log('\n✅ All API keys configured! You can run all tests.\n');
  console.log('Run: npm run test:all\n');
} else {
  console.log('\n⚠️ Some API keys are missing.\n');
  
  if (testsAvailable.length > 0) {
    console.log('Available tests:');
    for (const test of [...new Set(testsAvailable)]) {
      console.log(`  npm run ${test}`);
    }
  }
  
  if (testsMissing.length > 0) {
    console.log('\nUnavailable tests (missing API keys):');
    for (const test of [...new Set(testsMissing)]) {
      console.log(`  npm run ${test}`);
    }
  }
  
  console.log('\n📝 To configure API keys, create a .env file:');
  console.log('   cp .env.example .env');
  console.log('   # Then edit .env with your API keys\n');
}

// Exit with code 0 if at least one test is available
process.exit(testsAvailable.length > 0 ? 0 : 1);
