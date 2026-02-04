/**
 * Database layer: PostgreSQL + Redis
 */

const { pool, initDatabase } = require('./postgres');
const redis = require('./redis');

module.exports = {
  pool,
  initDatabase,
  redis
};
