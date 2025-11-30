/**
 * Deep Research Client
 * Handles research API requests with web search capabilities
 * Implements robust retry logic and NEVER crashes the server
 */

import OpenAI from 'openai';
import { RESEARCH } from '../config/index.js';
import {
  classifyError,
  sleep,
  ErrorCode,
  type StructuredError,
} from '../utils/errors.js';

export interface ResearchParams {
  question: string;
  systemPrompt?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxSearchResults?: number;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export interface ResearchResponse {
  id: string;
  model: string;
  created: number;
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    sourcesUsed?: number;
  };
  annotations?: Array<{
    type: 'url_citation';
    url: string;
    title: string;
    startIndex: number;
    endIndex: number;
  }>;
  error?: StructuredError;
}

// Research-specific retry configuration
// Research requests can be long-running, so we use longer delays
const RESEARCH_RETRY_CONFIG = {
  maxRetries: 2, // Fewer retries since requests are expensive
  baseDelayMs: 5000, // Longer base delay
  maxDelayMs: 60000,
} as const;

// Retryable status codes for research API
const RETRYABLE_RESEARCH_CODES = new Set([429, 500, 502, 503, 504]);

export class ResearchClient {
  private client: OpenAI;

  constructor() {
    if (!RESEARCH.API_KEY) {
      throw new Error('OPENROUTER_API_KEY is required for research');
    }

    this.client = new OpenAI({
      baseURL: RESEARCH.BASE_URL,
      apiKey: RESEARCH.API_KEY,
      timeout: RESEARCH.TIMEOUT_MS,
      maxRetries: 0, // We handle retries ourselves
    });
  }

  /**
   * Check if an error is retryable for research requests
   */
  private isRetryableError(error: unknown): boolean {
    if (!error) return false;

    const err = error as {
      status?: number;
      code?: string;
      message?: string;
    };

    // Check HTTP status codes
    if (err.status && RETRYABLE_RESEARCH_CODES.has(err.status)) {
      return true;
    }

    // Check message patterns
    const message = (err.message || '').toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('service unavailable') ||
      message.includes('connection')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate backoff for research retries
   */
  private calculateBackoff(attempt: number): number {
    const exponentialDelay = RESEARCH_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, RESEARCH_RETRY_CONFIG.maxDelayMs);
  }

  /**
   * Perform research with retry logic
   * Returns a ResearchResponse - may contain error field on failure
   * NEVER throws - always returns a valid response object
   */
  async research(params: ResearchParams): Promise<ResearchResponse> {
    const {
      question,
      systemPrompt,
      reasoningEffort = RESEARCH.REASONING_EFFORT,
      maxSearchResults = RESEARCH.MAX_URLS,
      maxTokens = 32000,
      temperature = 0.3,
      responseFormat,
    } = params;

    // Validate input
    if (!question?.trim()) {
      return {
        id: '',
        model: RESEARCH.MODEL,
        created: Date.now(),
        content: '',
        error: {
          code: ErrorCode.INVALID_INPUT,
          message: 'Research question cannot be empty',
          retryable: false,
        },
      };
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: question });

    const requestPayload: Record<string, unknown> = {
      model: RESEARCH.MODEL,
      messages,
      temperature,
      reasoning_effort: reasoningEffort,
      max_completion_tokens: maxTokens,
      search_parameters: {
        mode: 'on',
        max_search_results: Math.min(maxSearchResults, 30),
        return_citations: true,
        sources: [{ type: 'web' }],
      },
    };

    if (responseFormat) {
      requestPayload.response_format = responseFormat;
    }

    let lastError: StructuredError | undefined;

    // Retry loop
    for (let attempt = 0; attempt <= RESEARCH_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.error(`[Research] Retry attempt ${attempt}/${RESEARCH_RETRY_CONFIG.maxRetries}`);
        }

        const response = await this.client.chat.completions.create(requestPayload as any);
        const choice = response.choices?.[0];
        const message = choice?.message as any;

        // Validate response
        if (!message?.content && !choice) {
          lastError = {
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Research API returned empty response',
            retryable: true, // Might be a transient issue
          };

          if (attempt < RESEARCH_RETRY_CONFIG.maxRetries) {
            const delayMs = this.calculateBackoff(attempt);
            console.error(`[Research] Empty response, retrying in ${delayMs}ms...`);
            await sleep(delayMs);
            continue;
          }
        }

        return {
          id: response.id || '',
          model: response.model || RESEARCH.MODEL,
          created: response.created || Date.now(),
          content: message?.content || '',
          finishReason: choice?.finish_reason,
          usage: response.usage ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
            sourcesUsed: (response.usage as any).num_sources_used,
          } : undefined,
          annotations: message?.annotations?.map((a: any) => ({
            type: 'url_citation' as const,
            url: a.url_citation?.url || '',
            title: a.url_citation?.title || '',
            startIndex: a.url_citation?.start_index || 0,
            endIndex: a.url_citation?.end_index || 0,
          })),
        };

      } catch (error: unknown) {
        lastError = classifyError(error);

        const err = error as { status?: number; message?: string };
        console.error(`[Research] Error (attempt ${attempt + 1}): ${lastError.message}`, {
          status: err.status,
        });

        // Check if we should retry
        if (this.isRetryableError(error) && attempt < RESEARCH_RETRY_CONFIG.maxRetries) {
          const delayMs = this.calculateBackoff(attempt);
          console.error(`[Research] Retrying in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        // Non-retryable or max retries reached
        break;
      }
    }

    // All attempts failed - return error response
    const errorMessage = lastError?.message || 'Unknown research error';
    console.error(`[Research] All attempts failed: ${errorMessage}`);

    return {
      id: '',
      model: RESEARCH.MODEL,
      created: Date.now(),
      content: `Research failed: ${errorMessage}`,
      error: lastError || {
        code: ErrorCode.UNKNOWN_ERROR,
        message: errorMessage,
        retryable: false,
      },
    };
  }
}
