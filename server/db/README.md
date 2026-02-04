# Database Layer (PostgreSQL + Redis)

## Structure (matches schema images)

### PostgreSQL

- **users** – Accounts: `id`, `username`, `email`, `password_hash`, `avatar`, `coins`, `wins`, `games_played`, `created_at`
- **games** – Sessions: `id` (UUID), `game_type`, `status`, `players` (JSONB), `game_state` (JSONB), `winner_id`, `created_at`, `ended_at`, `saved_at`, `host_id`
- **game_history** – Per-user results: `id`, `game_id`, `user_id`, `game_type`, `result`, `score`, `played_at`
- **leaderboard** – Rankings: `id`, `user_id` (UQ), `game_type`, `score`, `rank`, `updated_at`
- **friends** – Friendships: `id`, `user_id`, `friend_id`, `status`, `created_at`, UNIQUE(`user_id`, `friend_id`)
- **in_app_purchases** – Store purchases

### Redis (optional)

- **Leaderboard cache** – `adda:leaderboard:{gameType}` (TTL 5 min)
- **User active game** – `adda:user:{userId}:game` (TTL 24h) for reconnection

## Environment

- `DATABASE_URL` – PostgreSQL connection string (required)
- `REDIS_URL` – Redis connection string (optional, default `redis://127.0.0.1:6379`)

If Redis is not available, the app still runs; cache and active-game keys are skipped.

## Running schema only

```bash
psql $DATABASE_URL -f server/schema.sql
```
