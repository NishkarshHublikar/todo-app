const Redis = require("ioredis");

const redis = new Redis({
  host: process.env.REDIS_HOST || "redis",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  maxRetriesPerRequest: 1,   // fail fast per-command so routes don't hang
  lazyConnect: true,
  enableOfflineQueue: false, // don't queue commands when disconnected
});

let _connected = false;

redis.on("connect", () => { _connected = true;  console.log("✅ Redis connected"); });
redis.on("close",   () => { _connected = false; console.warn("⚠️  Redis disconnected — cache disabled"); });
redis.on("error",   (err) => { /* ioredis logs internally; suppress noise */ });

const TTL = 300; // seconds — todo list cache lifetime (5 minutes)

async function cacheGet(key) {
  if (!_connected) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl = TTL) {
  if (!_connected) return;
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch { /* non-fatal */ }
}

async function cacheDel(key) {
  if (!_connected) return;
  try {
    await redis.del(key);
  } catch { /* non-fatal */ }
}

async function cacheDelPattern(pattern) {
  if (!_connected) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch { /* non-fatal */ }
}

/**
 * Higher-order function for "Read-Through" caching.
 * @param {string} key Cache key
 * @param {Function} fetcher Async function to fetch data if cache miss
 * @param {number} ttl Time to live in seconds
 */
async function withCache(key, fetcher, ttl = TTL) {
  const cached = await cacheGet(key);
  if (cached) return cached;

  const fresh = await fetcher();
  if (fresh) {
    await cacheSet(key, fresh, ttl);
  }
  return fresh;
}

// Graceful shutdown
process.on("SIGTERM", () => redis.disconnect());

module.exports = { redis, cacheGet, cacheSet, cacheDel, cacheDelPattern, withCache };
