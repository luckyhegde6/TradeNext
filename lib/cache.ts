// lib/cache.ts
import NodeCache from "node-cache";

// Standard TTL 60 seconds, check period 120 seconds
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

export default cache;
