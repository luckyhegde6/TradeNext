import { INDICES } from "@/lib/constants";

// Background workers disabled - Redis removed
console.log('Fetcher worker disabled - Redis not configured');

// Disabled queues and workers
let q: Queue | null = null;
let w: Worker | null = null;

// Always false since Redis is removed
if (false) {
  q = new Queue("nse-poll", { connection: redis.options });

  w = new Worker("nse-poll", async (job) => {
    if (job.name.startsWith("poll-index-chart-")) {
      const index = job.data.index;
      console.log(`WORKER: Polling chart for ${index}`);
      try {
        const data = await nseFetch(`/api/NextApi/apiClient/indexTrackerApi`, `?functionName=getIndexChart&&index=${encodeURIComponent(index)}&flag=1D`);
        // Store in Redis (1D chart)
        if (redis) {
          await redis.set(`nse:index:${index}:chart:1D`, JSON.stringify(data), "EX", 120);
        }
      } catch (e) {
        console.error("Worker failed for", index, e);
      }
    }
  });

  console.log('Background worker initialized with Redis');
} else {
  console.log('Background worker not initialized - Redis not available');
}

