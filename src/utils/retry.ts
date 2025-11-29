/**
 * Retry utility with exponential backoff
 * - 2x delay increase per attempt
 * - Max 10 second delay
 * - Up to 20 retries
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 20,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  multiplier: 2,
};

export function calculateDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const delay = config.initialDelayMs * Math.pow(config.multiplier, attempt);
  return Math.min(delay, config.maxDelayMs);
}

export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

export type RetryLogger = (message: string, level: 'info' | 'warn' | 'error') => void;

const defaultLogger: RetryLogger = (message, level) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [RETRY:${level.toUpperCase()}] ${message}`);
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  options: {
    shouldRetry?: (error: Error) => boolean;
    onRetry?: (attempt: number, delay: number, error: Error) => void;
    logger?: RetryLogger;
    operationName?: string;
  } = {}
): Promise<RetryResult<T>> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const { shouldRetry, onRetry, logger = defaultLogger, operationName = 'operation' } = options;
  
  let totalDelayMs = 0;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < fullConfig.maxRetries; attempt++) {
    try {
      const data = await fn();
      if (attempt > 0) {
        logger(`[${operationName}] Succeeded after ${attempt + 1} attempts (total delay: ${totalDelayMs}ms)`, 'info');
      }
      return { success: true, data, attempts: attempt + 1, totalDelayMs };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if this is a 429 or rate limit error
      const is429 = lastError.message.includes('429') || 
                    lastError.message.toLowerCase().includes('rate limit') ||
                    lastError.message.toLowerCase().includes('too many requests');
      
      // Check if we should retry
      const shouldRetryThis = shouldRetry ? shouldRetry(lastError) : is429;
      
      if (!shouldRetryThis) {
        logger(`[${operationName}] Non-retryable error: ${lastError.message}`, 'error');
        return { success: false, error: lastError, attempts: attempt + 1, totalDelayMs };
      }
      
      if (attempt < fullConfig.maxRetries - 1) {
        const delayMs = calculateDelay(attempt, fullConfig);
        totalDelayMs += delayMs;
        
        logger(
          `[${operationName}] Attempt ${attempt + 1}/${fullConfig.maxRetries} failed: ${lastError.message}. ` +
          `Retrying in ${delayMs}ms...`,
          'warn'
        );
        
        onRetry?.(attempt, delayMs, lastError);
        await delay(delayMs);
      }
    }
  }

  logger(`[${operationName}] All ${fullConfig.maxRetries} attempts failed. Last error: ${lastError?.message}`, 'error');
  return { success: false, error: lastError, attempts: fullConfig.maxRetries, totalDelayMs };
}

/**
 * Batch processor with rate limit handling
 */
export interface BatchConfig extends RetryConfig {
  batchSize: number;
  delayBetweenBatches: number;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  ...DEFAULT_RETRY_CONFIG,
  batchSize: 30,
  delayBetweenBatches: 500,
};

export interface BatchResult<T> {
  results: Array<{ index: number; success: boolean; data?: T; error?: Error; attempts: number }>;
  totalAttempts: number;
  rateLimitHits: number;
  totalDelayMs: number;
}

export async function processBatchWithRetry<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  config: Partial<BatchConfig> = {},
  options: {
    onItemComplete?: (index: number, total: number, result: { success: boolean; data?: R; error?: Error }) => void;
    onBatchComplete?: (batchNum: number, totalBatches: number, processed: number) => void;
    logger?: RetryLogger;
    operationName?: string;
  } = {}
): Promise<BatchResult<R>> {
  const fullConfig = { ...DEFAULT_BATCH_CONFIG, ...config };
  const { onItemComplete, onBatchComplete, logger = defaultLogger, operationName = 'batch' } = options;
  
  const totalBatches = Math.ceil(items.length / fullConfig.batchSize);
  const results: BatchResult<R>['results'] = [];
  let totalAttempts = 0;
  let rateLimitHits = 0;
  let totalDelayMs = 0;

  logger(`[${operationName}] Starting batch processing: ${items.length} items in ${totalBatches} batch(es)`, 'info');

  for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
    const startIdx = batchNum * fullConfig.batchSize;
    const endIdx = Math.min(startIdx + fullConfig.batchSize, items.length);
    const batchItems = items.slice(startIdx, endIdx);

    logger(`[${operationName}] Processing batch ${batchNum + 1}/${totalBatches} (${batchItems.length} items)`, 'info');

    const batchStartTime = Date.now();
    const batchResults = await Promise.allSettled(
      batchItems.map(async (item, localIdx) => {
        const globalIdx = startIdx + localIdx;
        const result = await retryWithBackoff(
          () => processor(item, globalIdx),
          fullConfig,
          {
            logger,
            operationName: `${operationName}[${globalIdx}]`,
            shouldRetry: (error) => {
              const is429 = error.message.includes('429') || 
                           error.message.toLowerCase().includes('rate limit');
              if (is429) rateLimitHits++;
              return is429;
            },
          }
        );
        return { index: globalIdx, ...result };
      })
    );

    const batchTime = Date.now() - batchStartTime;
    logger(`[${operationName}] Batch ${batchNum + 1} completed in ${batchTime}ms`, 'info');

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        totalAttempts += result.value.attempts;
        totalDelayMs += result.value.totalDelayMs;
        onItemComplete?.(result.value.index, items.length, {
          success: result.value.success,
          data: result.value.data,
          error: result.value.error,
        });
      } else {
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        results.push({ index: -1, success: false, error, attempts: 1 });
        totalAttempts++;
      }
    }

    onBatchComplete?.(batchNum + 1, totalBatches, results.length);

    if (batchNum < totalBatches - 1) {
      logger(`[${operationName}] Waiting ${fullConfig.delayBetweenBatches}ms before next batch...`, 'info');
      await delay(fullConfig.delayBetweenBatches);
      totalDelayMs += fullConfig.delayBetweenBatches;
    }
  }

  const successful = results.filter(r => r.success).length;
  logger(
    `[${operationName}] Complete: ${successful}/${items.length} succeeded, ${rateLimitHits} rate limits, ` +
    `${totalAttempts} total attempts, ${totalDelayMs}ms total delay`,
    'info'
  );

  return { results, totalAttempts, rateLimitHits, totalDelayMs };
}
