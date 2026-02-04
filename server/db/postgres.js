/**
 * PostgreSQL pool and schema initialization.
 * Schema matches: users, games, game_history, leaderboard, friends (+ in_app_purchases).
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const schemaSql = `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar VARCHAR(255) DEFAULT 'default',
  coins INT DEFAULT 100,
  wins INT DEFAULT 0,
  games_played INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Games
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY,
  game_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  players JSONB DEFAULT '[]',
  game_state JSONB DEFAULT '{}',
  winner_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  saved_at TIMESTAMP,
  host_id INT REFERENCES users(id)
);

-- Game history (game logs)
CREATE TABLE IF NOT EXISTS game_history (
  id SERIAL PRIMARY KEY,
  game_id UUID REFERENCES games(id),
  user_id INT REFERENCES users(id),
  game_type VARCHAR(50) NOT NULL,
  result VARCHAR(20),
  score INT DEFAULT 0,
  played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Leaderboard
CREATE TABLE IF NOT EXISTS leaderboard (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) UNIQUE,
  game_type VARCHAR(50),
  score INT DEFAULT 0,
  rank INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Friends
CREATE TABLE IF NOT EXISTS friends (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  friend_id INT REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, friend_id)
);

-- In-app purchases
CREATE TABLE IF NOT EXISTS in_app_purchases (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  item_type VARCHAR(50) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  item_name VARCHAR(200),
  price INT DEFAULT 0,
  purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_game_history_user_id ON game_history(user_id);
CREATE INDEX IF NOT EXISTS idx_game_history_game_type ON game_history(game_type);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_game_type ON games(game_type);
-- Themes (plan §3 optional)
CREATE TABLE IF NOT EXISTS themes (
  id SERIAL PRIMARY KEY,
  game_type VARCHAR(50) NOT NULL,
  theme_id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  price INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_type, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
`;

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(schemaSql);
    console.log('PostgreSQL schema initialized successfully');
  } catch (err) {
    console.error('PostgreSQL initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDatabase
};
