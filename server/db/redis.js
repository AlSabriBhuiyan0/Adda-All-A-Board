/**
 * Redis client for cache, sessions, and real-time data.
 * Uses: leaderboard cache, session store, active game keys.
 * Redis is optional: if unavailable, cache and active-game helpers no-op.
 */

let Redis;
try {
  Redis = require('ioredis');
} catch (e) {
  Redis = null;
}

function getRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const username = process.env.REDIS_USERNAME || '';
  const password = process.env.REDIS_PASSWORD || '';
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = process.env.REDIS_PORT || '6379';
  const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  return `redis://${auth}${host}:${port}`;
}

const REDIS_URL = getRedisUrl();

let client = null;
let redisDisabled = false;

function getRedis() {
  if (redisDisabled || !Redis) return null;
  if (client) return client;
  try {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          redisDisabled = true;
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true
    });
    client.on('error', (err) => console.warn('Redis error:', err.message));
    client.on('connect', () => console.log('Redis connected'));
    return client;
  } catch (err) {
    console.warn('Redis not available:', err.message);
    redisDisabled = true;
    return null;
  }
}

async function connectRedis() {
  const redis = getRedis();
  if (redis) {
    await redis.connect().catch(() => {
      redisDisabled = true;
    });
  }
  return redis;
}

// Key prefixes
const PREFIX = 'adda:';
const LEADERBOARD_KEY = (gameType) => `${PREFIX}leaderboard:${gameType || 'global'}`;
const SESSION_KEY = (tokenId) => `${PREFIX}session:${tokenId}`;
const ACTIVE_GAME_KEY = (userId) => `${PREFIX}user:${userId}:game`;
const CACHE_TTL = 300; // 5 minutes

/** Cache leaderboard in Redis */
async function setLeaderboardCache(gameType, data) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(
      LEADERBOARD_KEY(gameType),
      CACHE_TTL,
      JSON.stringify(data)
    );
  } catch (e) {
    // ignore
  }
}

/** Get leaderboard from Redis cache */
async function getLeaderboardCache(gameType) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(LEADERBOARD_KEY(gameType));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Store user's current game id (for reconnection) */
async function setUserActiveGame(userId, gameId) {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (gameId) {
      await redis.setex(ACTIVE_GAME_KEY(userId), 86400, gameId); // 24h
    } else {
      await redis.del(ACTIVE_GAME_KEY(userId));
    }
  } catch (e) {
    // ignore
  }
}

/** Get user's current game id */
async function getUserActiveGame(userId) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(ACTIVE_GAME_KEY(userId));
  } catch (e) {
    return null;
  }
}

/** Invalidate leaderboard cache (e.g. after game end) */
async function invalidateLeaderboardCache(gameType) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(LEADERBOARD_KEY(gameType));
    await redis.del(LEADERBOARD_KEY(null));
  } catch (e) {
    // ignore
  }
}

const LOGOUT_PREFIX = `${PREFIX}logout:`;

/** Check if token was revoked (logout) */
async function isTokenBlacklisted(token) {
  const redis = getRedis();
  if (!redis || !token) return false;
  try {
    const key = LOGOUT_PREFIX + String(token).substring(0, 32);
    const v = await redis.get(key);
    return v === '1';
  } catch (e) {
    return false;
  }
}

module.exports = {
  getRedis,
  connectRedis,
  setLeaderboardCache,
  getLeaderboardCache,
  setUserActiveGame,
  getUserActiveGame,
  invalidateLeaderboardCache,
  isTokenBlacklisted,
  PREFIX
};
