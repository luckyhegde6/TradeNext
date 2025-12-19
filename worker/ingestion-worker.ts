// Background workers disabled - Redis removed
import logger from "@/lib/logger";

logger.info({ msg: 'Background workers disabled - Redis not configured' });

// Disabled queues
export const ingestionQueue = null;
export const marketDataQueue = null;

// Worker for data ingestion
if (ingestionQueue) {
  const ingestionWorker = new Worker("data-ingestion", async (job) => {
    const startTime = Date.now();
    const { type, data } = job.data;

    logger.info({ msg: 'Starting ingestion job', jobId: job.id, type, data: Object.keys(data || {}) });

    try {
      switch (type) {
        case "csv-ingestion": {
          const result = await runIngestion(data.csvPath);
          const duration = Date.now() - startTime;

          if (result.status === 'error') {
            logger.error({ msg: 'CSV ingestion failed', jobId: job.id, error: result.error, duration });
            throw new Error(result.error);
          }

          logger.info({ msg: 'CSV ingestion completed', jobId: job.id, rows: result.rows, duration });
          return { status: 'completed', rows: result.rows };
        }

        case "index-refresh": {
          const { indexName } = data;
          logger.info({ msg: 'Refreshing index data', jobId: job.id, indexName });

          // Refresh various index data
          const [details, heatmap, announcements] = await Promise.allSettled([
            getIndexDetails(indexName, true),
            getIndexHeatmap(indexName),
            getIndexAnnouncements(indexName)
          ]);

          const results = {
            details: details.status === 'fulfilled' ? 'success' : details.reason?.message,
            heatmap: heatmap.status === 'fulfilled' ? 'success' : heatmap.reason?.message,
            announcements: announcements.status === 'fulfilled' ? 'success' : announcements.reason?.message
          };

          const duration = Date.now() - startTime;
          logger.info({ msg: 'Index refresh completed', jobId: job.id, indexName, results, duration });

          return { status: 'completed', results };
        }

        case "stock-refresh": {
          const { symbol } = data;
          logger.info({ msg: 'Refreshing stock data', jobId: job.id, symbol });

          // Refresh stock data
          const [quote, chart1D, trends] = await Promise.allSettled([
            getStockQuote(symbol, true),
            getStockChart(symbol, '1D'),
            getStockTrends(symbol)
          ]);

          const results = {
            quote: quote.status === 'fulfilled' ? 'success' : quote.reason?.message,
            chart1D: chart1D.status === 'fulfilled' ? 'success' : chart1D.reason?.message,
            trends: trends.status === 'fulfilled' ? 'success' : trends.reason?.message
          };

          const duration = Date.now() - startTime;
          logger.info({ msg: 'Stock refresh completed', jobId: job.id, symbol, results, duration });

          return { status: 'completed', results };
        }

        default:
          throw new Error(`Unknown ingestion type: ${type}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ msg: 'Ingestion job failed', jobId: job.id, type, error: errorMessage, duration });
      throw error;
    }
  }, { connection });

  // Worker event handlers
  ingestionWorker.on('completed', (job) => {
    logger.info({ msg: 'Ingestion job completed', jobId: job.id, type: job.data.type });
  });

  ingestionWorker.on('failed', (job, err) => {
    logger.error({ msg: 'Ingestion job failed', jobId: job?.id, type: job?.data?.type, error: err.message });
  });

  logger.info({ msg: 'Ingestion worker initialized' });
}

// Worker for market data polling
if (marketDataQueue) {
  const marketDataWorker = new Worker("market-data", async (job) => {
    const startTime = Date.now();
    const { type, data } = job.data;

    logger.debug({ msg: 'Processing market data job', jobId: job.id, type });

    try {
      switch (type) {
        case "poll-index": {
          const { indexName } = data;
          const details = await getIndexDetails(indexName, false); // Don't start new polling
          const duration = Date.now() - startTime;
          logger.debug({ msg: 'Index poll completed', jobId: job.id, indexName, duration });
          return { status: 'completed', data: details };
        }

        case "poll-stock": {
          const { symbol } = data;
          const quote = await getStockQuote(symbol, false); // Don't start new polling
          const duration = Date.now() - startTime;
          logger.debug({ msg: 'Stock poll completed', jobId: job.id, symbol, duration });
          return { status: 'completed', data: quote };
        }

        default:
          throw new Error(`Unknown market data type: ${type}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ msg: 'Market data job failed', jobId: job.id, type, error: errorMessage, duration });
      throw error;
    }
  }, { connection });

  // Worker event handlers
  marketDataWorker.on('completed', (job) => {
    logger.debug({ msg: 'Market data job completed', jobId: job.id, type: job.data.type });
  });

  marketDataWorker.on('failed', (job, err) => {
    logger.error({ msg: 'Market data job failed', jobId: job?.id, type: job?.data?.type, error: err.message });
  });

  logger.info({ msg: 'Market data worker initialized' });
}

// Utility functions for queue management
export const queueManager = {
  // Add CSV ingestion job
  async addCsvIngestion(csvPath?: string) {
    if (!ingestionQueue) {
      throw new Error('Ingestion queue not available - Redis not configured');
    }

    const job = await ingestionQueue.add('csv-ingestion', {
      type: 'csv-ingestion',
      data: { csvPath }
    }, {
      priority: 10, // High priority for user-triggered ingestion
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });

    logger.info({ msg: 'CSV ingestion job queued', jobId: job.id, csvPath });
    return job;
  },

  // Add index refresh job
  async addIndexRefresh(indexName: string) {
    if (!ingestionQueue) {
      throw new Error('Ingestion queue not available - Redis not configured');
    }

    const job = await ingestionQueue.add('index-refresh', {
      type: 'index-refresh',
      data: { indexName }
    }, {
      priority: 5,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 3000
      }
    });

    logger.info({ msg: 'Index refresh job queued', jobId: job.id, indexName });
    return job;
  },

  // Add stock refresh job
  async addStockRefresh(symbol: string) {
    if (!ingestionQueue) {
      throw new Error('Ingestion queue not available - Redis not configured');
    }

    const job = await ingestionQueue.add('stock-refresh', {
      type: 'stock-refresh',
      data: { symbol }
    }, {
      priority: 5,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 3000
      }
    });

    logger.info({ msg: 'Stock refresh job queued', jobId: job.id, symbol });
    return job;
  },

  // Add market data polling job
  async addMarketDataPoll(type: 'index' | 'stock', identifier: string) {
    if (!marketDataQueue) {
      throw new Error('Market data queue not available - Redis not configured');
    }

    const jobType = type === 'index' ? 'poll-index' : 'poll-stock';
    const data = type === 'index' ? { indexName: identifier } : { symbol: identifier };

    const job = await marketDataQueue.add(jobType, {
      type: jobType,
      data
    }, {
      priority: 1, // Low priority for background polling
      attempts: 1, // Don't retry polling jobs
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50 // Keep last 50 failed jobs
    });

    logger.debug({ msg: 'Market data poll job queued', jobId: job.id, type, identifier });
    return job;
  },

  // Get queue statistics
  async getQueueStats() {
    if (!ingestionQueue || !marketDataQueue) {
      return { error: 'Queues not available - Redis not configured' };
    }

    const [ingestionStats, marketStats] = await Promise.all([
      ingestionQueue.getJobCounts(),
      marketDataQueue.getJobCounts()
    ]);

    return {
      ingestion: ingestionStats,
      marketData: marketStats,
      timestamp: new Date().toISOString()
    };
  }
};
