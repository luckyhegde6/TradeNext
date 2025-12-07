import { Queue, Worker } from "bullmq";
import { nseFetch, redis } from "@/lib/nse-client";
import { INDICES } from "@/lib/constants";

const q = new Queue("nse-poll", { connection: { host: "localhost", port: 6379 } });

const w = new Worker("nse-poll", async (job) => {
  if (job.name.startsWith("poll-index-chart-")) {
    const index = job.data.index;
    console.log(`WORKER: Polling chart for ${index}`);
    try {
      const data = await nseFetch(`/api/NextApi/apiClient/indexTrackerApi`, `?functionName=getIndexChart&&index=${encodeURIComponent(index)}&flag=1D`);
      // Store in Redis (1D chart)
      await redis.set(`nse:index:${index}:chart:1D`, JSON.stringify(data), "EX", 120);
    } catch (e) {
      console.error("Worker failed for", index, e);
    }
  }
});

