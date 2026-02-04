require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { pool, initDatabase, redis: redisClient } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting (plan §9: prevent abuse and DDoS)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true
});
app.use('/api/', apiLimiter);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set. Using temporary secret for development only.');
}
const SECRET = JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

const activeGames = new Map();
const waitingPlayers = new Map();

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, coins, wins, games_played, avatar',
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, username: user.username }, SECRET, { expiresIn: '7d' });

    res.json({ user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, coins, wins, games_played, avatar FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    delete user.password_hash;
    const token = jwt.sign({ userId: user.id, username: user.username }, SECRET, { expiresIn: '7d' });

    res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      'SELECT id, username, email, coins, wins, games_played, avatar FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /auth/logout (plan §4) – optional server-side: blacklist token in Redis
app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ success: true });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp && redisClient && redisClient.getRedis()) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redisClient.getRedis().setex(`adda:logout:${token.substring(0, 32)}`, ttl, '1');
      }
    }
  } catch (e) {
    // ignore
  }
  res.json({ success: true });
});

// POST /auth/refresh (plan §4) – token refresh
app.post('/api/auth/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    if (redisClient && await redisClient.isTokenBlacklisted(token)) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      'SELECT id, username, email, coins, wins, games_played, avatar FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = result.rows[0];
    const newToken = jwt.sign({ userId: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
    res.json({ user, token: newToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const gameType = req.query.game_type || null;
    const friendsOnly = req.query.friends_only === 'true' || req.query.friends_only === '1';
    const authHeader = req.headers.authorization;

    if (friendsOnly && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, SECRET);
        const result = await pool.query(
          `SELECT u.id, u.username, u.wins, u.games_played, u.avatar
           FROM users u
           INNER JOIN friends f ON (f.friend_id = u.id AND f.user_id = $1) OR (f.user_id = u.id AND f.friend_id = $1)
           WHERE f.status = 'accepted'
           ORDER BY u.wins DESC
           LIMIT 50`,
          [decoded.userId]
        );
        return res.json(result.rows);
      } catch (e) {
        // fall through to global
      }
    }

    const cached = redisClient && !friendsOnly && await redisClient.getLeaderboardCache(gameType);
    if (cached) {
      return res.json(cached);
    }
    const result = await pool.query(
      'SELECT id, username, wins, games_played, avatar FROM users ORDER BY wins DESC LIMIT 50'
    );
    if (redisClient && !friendsOnly) await redisClient.setLeaderboardCache(gameType, result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/games/active', async (req, res) => {
  try {
    const games = [];
    activeGames.forEach((game, id) => {
      if (game.status === 'waiting') {
        games.push({
          id,
          type: game.type,
          players: game.players.length,
          maxPlayers: game.maxPlayers,
          host: game.players[0]?.username
        });
      }
    });
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /games/{gameId} (plan §4) – retrieve game details
app.get('/api/games/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = activeGames.get(gameId);
    if (game) {
      return res.json({
        id: gameId,
        type: game.type,
        status: game.status,
        players: game.players.length,
        maxPlayers: game.maxPlayers,
        host: game.players[0]?.username,
        gameState: game.getState()
      });
    }
    const row = await pool.query(
      'SELECT id, game_type, status, players, game_state, winner_id, created_at, ended_at FROM games WHERE id = $1',
      [gameId]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const g = row.rows[0];
    res.json({
      id: g.id,
      type: g.game_type,
      status: g.status,
      players: g.players,
      gameState: g.game_state,
      winnerId: g.winner_id,
      createdAt: g.created_at,
      endedAt: g.ended_at
    });
  } catch (err) {
    console.error('Get game error:', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

// Friend System API Endpoints
app.get('/api/friends', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      `SELECT f.id, f.status, f.created_at,
              u.id as friend_id, u.username, u.avatar, u.wins, u.games_played
       FROM friends f
       JOIN users u ON (f.friend_id = u.id AND f.user_id = $1) OR (f.user_id = u.id AND f.friend_id = $1)
       WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
       ORDER BY u.username`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Friends list error:', err);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

app.get('/api/friends/pending', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      `SELECT f.id, f.status, f.created_at,
              u.id as friend_id, u.username, u.avatar
       FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = $1 AND f.status = 'pending'`,
      [decoded.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Pending friends error:', err);
    res.status(500).json({ error: 'Failed to fetch pending requests' });
  }
});

app.post('/api/friends/add', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.userId;

    // Find user by username
    const userResult = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const friendId = userResult.rows[0].id;

    if (userId === friendId) {
      return res.status(400).json({ error: 'Cannot add yourself as friend' });
    }

    // Check if friendship already exists
    const existingResult = await pool.query(
      'SELECT * FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [userId, friendId]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      if (existing.status === 'pending' && existing.user_id === userId) {
        return res.status(400).json({ error: 'Friend request already sent' });
      }
    }

    // Create friend request
    await pool.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)',
      [userId, friendId, 'pending']
    );

    res.json({ success: true, message: 'Friend request sent' });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { friendId } = req.body;

  if (!friendId) {
    return res.status(400).json({ error: 'Friend ID required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.userId;

    const result = await pool.query(
      'UPDATE friends SET status = $1 WHERE user_id = $2 AND friend_id = $3 AND status = $4',
      ['accepted', friendId, userId, 'pending']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    res.json({ success: true, message: 'Friend request accepted' });
  } catch (err) {
    console.error('Accept friend error:', err);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

app.post('/api/friends/reject', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { friendId } = req.body;

  if (!friendId) {
    return res.status(400).json({ error: 'Friend ID required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.userId;

    await pool.query(
      'DELETE FROM friends WHERE user_id = $2 AND friend_id = $3 AND status = $4',
      [friendId, userId, 'pending']
    );

    res.json({ success: true, message: 'Friend request rejected' });
  } catch (err) {
    console.error('Reject friend error:', err);
    res.status(500).json({ error: 'Failed to reject friend request' });
  }
});

app.post('/api/friends/remove', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { friendId } = req.body;

  if (!friendId) {
    return res.status(400).json({ error: 'Friend ID required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.userId;

    await pool.query(
      'DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
      [userId, friendId]
    );

    res.json({ success: true, message: 'Friend removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

app.get('/api/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT id, username, email, avatar, coins, wins, games_played, created_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get game history stats
    const statsResult = await pool.query(
      `SELECT game_type, COUNT(*) as games, 
              SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins
       FROM game_history WHERE user_id = $1 GROUP BY game_type`,
      [userId]
    );

    const user = result.rows[0];
    user.stats = statsResult.rows;

    res.json(user);
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/user/add-coins', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { amount } = req.body;

  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      'UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING coins',
      [amount || 10, decoded.userId]
    );

    res.json({ success: true, coins: result.rows[0].coins });
  } catch (err) {
    console.error('Add coins error:', err);
    res.status(500).json({ error: 'Failed to add coins' });
  }
});

app.get('/api/games/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT gh.game_type, gh.result, gh.played_at, g.id as game_id
       FROM game_history gh
       LEFT JOIN games g ON gh.game_id = g.id
       WHERE gh.user_id = $1
       ORDER BY gh.played_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Game history error:', err);
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// In-App Purchases Endpoints
const SHOP_ITEMS = {
  themes: {
    'ludo-candy': { name: 'Candy Theme', price: 50, game: 'ludo' },
    'ludo-pirate': { name: 'Pirate Theme', price: 50, game: 'ludo' },
    'ludo-christmas': { name: 'Christmas Theme', price: 75, game: 'ludo' },
    'monopoly-classic': { name: 'Classic Monopoly Theme', price: 100, game: 'monopoly' },
    'uno-rainbow': { name: 'Rainbow UNO Theme', price: 60, game: 'uno' }
  },
  cosmetics: {
    'avatar-frame-gold': { name: 'Gold Avatar Frame', price: 200 },
    'avatar-frame-silver': { name: 'Silver Avatar Frame', price: 150 },
    'dice-skin-premium': { name: 'Premium Dice Skin', price: 100 }
  }
};

app.get('/api/shop', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    
    // Get user's purchases
    const purchasesResult = await pool.query(
      'SELECT item_type, item_id FROM in_app_purchases WHERE user_id = $1',
      [decoded.userId]
    );
    
    const purchasedItems = new Set();
    purchasesResult.rows.forEach(row => {
      purchasedItems.add(`${row.item_type}:${row.item_id}`);
    });
    
    // Mark items as purchased
    const shopItems = {
      themes: Object.entries(SHOP_ITEMS.themes).map(([id, item]) => ({
        id,
        ...item,
        purchased: purchasedItems.has(`themes:${id}`)
      })),
      cosmetics: Object.entries(SHOP_ITEMS.cosmetics).map(([id, item]) => ({
        id,
        ...item,
        purchased: purchasedItems.has(`cosmetics:${id}`)
      }))
    };
    
    res.json(shopItems);
  } catch (err) {
    console.error('Shop error:', err);
    res.status(500).json({ error: 'Failed to fetch shop items' });
  }
});

app.post('/api/shop/purchase', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { itemType, itemId } = req.body;

  if (!itemType || !itemId) {
    return res.status(400).json({ error: 'Item type and ID required' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    const userId = decoded.userId;
    
    // Find item
    const item = SHOP_ITEMS[itemType]?.[itemId];
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Check if already purchased
    const existingPurchase = await pool.query(
      'SELECT id FROM in_app_purchases WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [userId, itemType, itemId]
    );
    
    if (existingPurchase.rows.length > 0) {
      return res.status(400).json({ error: 'Item already purchased' });
    }
    
    // Check user coins
    const userResult = await pool.query(
      'SELECT coins FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userCoins = userResult.rows[0].coins;
    if (userCoins < item.price) {
      return res.status(400).json({ error: 'Insufficient coins' });
    }
    
    // Process purchase
    await pool.query('BEGIN');
    
    try {
      // Deduct coins
      await pool.query(
        'UPDATE users SET coins = coins - $1 WHERE id = $2',
        [item.price, userId]
      );
      
      // Record purchase
      await pool.query(
        'INSERT INTO in_app_purchases (user_id, item_type, item_id, item_name, price) VALUES ($1, $2, $3, $4, $5)',
        [userId, itemType, itemId, item.name, item.price]
      );
      
      await pool.query('COMMIT');
      
      // Get updated user
      const updatedUser = await pool.query(
        'SELECT coins FROM users WHERE id = $1',
        [userId]
      );
      
      res.json({
        success: true,
        message: 'Purchase successful',
        remainingCoins: updatedUser.rows[0].coins
      });
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('Purchase error:', err);
    res.status(500).json({ error: 'Failed to process purchase' });
  }
});

// Save/Resume Game Endpoints
app.post('/api/games/:gameId/save', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { gameId } = req.params;

  try {
    const decoded = jwt.verify(token, SECRET);
    const game = activeGames.get(gameId);
    
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if user is in the game
    const playerInGame = game.players.find(p => p.id === decoded.userId);
    if (!playerInGame) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }

    // Save game state to database
    await pool.query(
      `INSERT INTO games (id, game_type, status, players, game_state, host_id, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE SET 
         status = $3,
         players = $4,
         game_state = $5,
         saved_at = NOW()`,
      [
        gameId,
        game.type,
        'saved',
        JSON.stringify(game.players.map(p => ({ id: p.id, username: p.username }))),
        JSON.stringify(game.getState()),
        game.players[0]?.id
      ]
    );

    res.json({ success: true, message: 'Game saved' });
  } catch (err) {
    console.error('Save game error:', err);
    res.status(500).json({ error: 'Failed to save game' });
  }
});

app.get('/api/games/saved', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      `SELECT id, game_type, status, players, game_state, saved_at, host_id
       FROM games 
       WHERE status = 'saved' 
       AND (players::jsonb @> $1::jsonb OR host_id = $2)
       ORDER BY saved_at DESC`,
      [JSON.stringify([{ id: decoded.userId }]), decoded.userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get saved games error:', err);
    res.status(500).json({ error: 'Failed to fetch saved games' });
  }
});

app.post('/api/games/:gameId/resume', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  const { gameId } = req.params;

  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      'SELECT * FROM games WHERE id = $1 AND status = $2',
      [gameId, 'saved']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saved game not found' });
    }

    const savedGame = result.rows[0];
    const gameState = JSON.parse(savedGame.game_state);
    const players = JSON.parse(savedGame.players);

    // Check if user is in the game
    const playerInGame = players.find(p => p.id === decoded.userId);
    if (!playerInGame) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }

    // Restore game to activeGames
    let game;
    if (savedGame.game_type === 'ludo') {
      game = new LudoGame(gameId);
    } else if (savedGame.game_type === 'monopoly') {
      game = new MonopolyGame(gameId);
    } else if (savedGame.game_type === 'uno') {
      game = new UnoGame(gameId);
    }

    // Restore game state
    game.status = 'playing';
    game.players = players.map(p => ({
      ...p,
      socketId: null // Will be set when players reconnect
    }));
    game.currentPlayerIndex = gameState.currentPlayerIndex || 0;

    // Restore game-specific state
    if (savedGame.game_type === 'ludo') {
      game.board = gameState.board || game.initBoard();
      game.diceValue = gameState.diceValue;
    } else if (savedGame.game_type === 'monopoly') {
      game.board = gameState.board || game.initBoard();
      game.diceValue = gameState.diceValue || [0, 0];
      game.players.forEach((p, idx) => {
        const savedPlayer = gameState.players?.[idx];
        if (savedPlayer) {
          p.position = savedPlayer.position;
          p.money = savedPlayer.money;
          p.properties = savedPlayer.properties || [];
          p.inJail = savedPlayer.inJail || false;
        }
      });
    } else if (savedGame.game_type === 'uno') {
      game.deck = gameState.deck || [];
      game.discardPile = gameState.discardPile || [];
      game.currentColor = gameState.currentColor;
      game.direction = gameState.direction || 1;
      game.players.forEach((p, idx) => {
        const savedPlayer = gameState.players?.[idx];
        if (savedPlayer && savedPlayer.hand) {
          p.hand = savedPlayer.hand;
        }
      });
    }

    activeGames.set(gameId, game);

    // Update database status
    await pool.query(
      'UPDATE games SET status = $1, saved_at = NULL WHERE id = $2',
      ['playing', gameId]
    );

    res.json({ success: true, gameState: game.getState() });
  } catch (err) {
    console.error('Resume game error:', err);
    res.status(500).json({ error: 'Failed to resume game' });
  }
});

class LudoGame {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.maxPlayers = 4;
    this.currentPlayerIndex = 0;
    this.diceValue = null;
    this.status = 'waiting';
    this.type = 'ludo';
    this.board = this.initBoard();
    this.colors = ['red', 'blue', 'green', 'yellow'];
    this.turnTimeout = null;
    this.turnStartTime = null;
    this.turnTimeoutDuration = 60000; // 60 seconds
  }

  initBoard() {
    return {
      pieces: {},
      homePositions: {
        red: [0, 1, 2, 3],
        blue: [0, 1, 2, 3],
        green: [0, 1, 2, 3],
        yellow: [0, 1, 2, 3]
      },
      startPositions: { red: 1, blue: 14, green: 27, yellow: 40 },
      safeSpots: [1, 9, 14, 22, 27, 35, 40, 48]
    };
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    const color = this.colors[this.players.length];
    this.players.push({ ...player, color, pieces: [0, 0, 0, 0] });
    this.board.pieces[color] = [-1, -1, -1, -1];
    return true;
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
      return true;
    }
    return false;
  }

  startGame() {
    if (this.players.length >= 2) {
      this.status = 'playing';
      this.currentPlayerIndex = 0;
      this.startTurnTimer();
      return true;
    }
    return false;
  }

  startTurnTimer() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
    }
    this.turnStartTime = Date.now();
    this.turnTimeout = setTimeout(() => {
      this.handleTurnTimeout();
    }, this.turnTimeoutDuration);
  }

  handleTurnTimeout() {
    if (this.status !== 'playing') return;
    
    // Auto-advance turn
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.diceValue = null;
    
    // Notify players
    io.to(this.gameId).emit('turn_timeout', {
      skippedPlayerIndex: (this.currentPlayerIndex - 1 + this.players.length) % this.players.length,
      gameState: this.getState()
    });
    
    this.startTurnTimer();
  }

  rollDice() {
    this.diceValue = Math.floor(Math.random() * 6) + 1;
    return this.diceValue;
  }

  canMove(playerIndex, pieceIndex) {
    const player = this.players[playerIndex];
    if (!player) return false;
    
    const piecePos = player.pieces[pieceIndex];
    
    if (piecePos === -1 && this.diceValue === 6) return true;
    if (piecePos === -1 && this.diceValue !== 6) return false;
    if (piecePos >= 0 && piecePos + this.diceValue <= 57) return true;
    
    return false;
  }

  movePiece(playerIndex, pieceIndex) {
    const player = this.players[playerIndex];
    if (!player || playerIndex !== this.currentPlayerIndex) return { success: false };
    
    if (!this.canMove(playerIndex, pieceIndex)) return { success: false };

    let currentPos = player.pieces[pieceIndex];
    let newPos;
    let captured = null;

    if (currentPos === -1) {
      newPos = 0;
    } else {
      newPos = currentPos + this.diceValue;
    }

    if (newPos === 57) {
      player.pieces[pieceIndex] = 57;
      
      if (player.pieces.every(p => p === 57)) {
        this.status = 'finished';
        return { success: true, winner: player, newPos };
      }
    } else {
      player.pieces[pieceIndex] = newPos;
      
      const absolutePos = (this.board.startPositions[player.color] + newPos - 1) % 52;
      if (!this.board.safeSpots.includes(absolutePos)) {
        for (const otherPlayer of this.players) {
          if (otherPlayer.color === player.color) continue;
          for (let i = 0; i < 4; i++) {
            if (otherPlayer.pieces[i] >= 0 && otherPlayer.pieces[i] < 52) {
              const otherAbsPos = (this.board.startPositions[otherPlayer.color] + otherPlayer.pieces[i] - 1) % 52;
              if (otherAbsPos === absolutePos) {
                otherPlayer.pieces[i] = -1;
                captured = { player: otherPlayer.color, piece: i };
              }
            }
          }
        }
      }
    }

    if (this.diceValue !== 6 && !captured) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      this.startTurnTimer();
    }

    this.diceValue = null;

    return { success: true, newPos, captured };
  }

  getState() {
    return {
      gameId: this.gameId,
      type: this.type,
      status: this.status,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        color: p.color,
        pieces: p.pieces,
        avatar: p.avatar
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      diceValue: this.diceValue,
      maxPlayers: this.maxPlayers
    };
  }
}

class MonopolyGame {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.maxPlayers = 6;
    this.currentPlayerIndex = 0;
    this.diceValue = [0, 0];
    this.status = 'waiting';
    this.type = 'monopoly';
    this.board = this.initBoard();
    this.tokens = ['car', 'hat', 'dog', 'ship', 'boot', 'thimble'];
    this.chanceCards = this.initChanceCards();
    this.chestCards = this.initChestCards();
    this.turnTimeout = null;
    this.turnStartTime = null;
    this.turnTimeoutDuration = 90000; // 90 seconds for Monopoly
  }

  initChanceCards() {
    return [
      { text: 'Advance to GO. Collect $200.', effect: 200 },
      { text: 'Bank pays you dividend of $50.', effect: 50 },
      { text: 'Your building loan matures. Collect $150.', effect: 150 },
      { text: 'You have won a crossword competition. Collect $100.', effect: 100 },
      { text: 'Pay poor tax of $15.', effect: -15 },
      { text: 'Speeding fine $15.', effect: -15 },
      { text: 'You are assessed for street repairs. Pay $40.', effect: -40 },
      { text: 'Pay school fees of $50.', effect: -50 }
    ];
  }

  initChestCards() {
    return [
      { text: 'Bank error in your favor. Collect $200.', effect: 200 },
      { text: 'Doctor\'s fees. Pay $50.', effect: -50 },
      { text: 'From sale of stock you get $50.', effect: 50 },
      { text: 'Holiday fund matures. Receive $100.', effect: 100 },
      { text: 'Income tax refund. Collect $20.', effect: 20 },
      { text: 'Life insurance matures. Collect $100.', effect: 100 },
      { text: 'Pay hospital fees of $100.', effect: -100 },
      { text: 'You inherit $100.', effect: 100 }
    ];
  }

  drawCard(type) {
    const cards = type === 'chance' ? this.chanceCards : this.chestCards;
    return cards[Math.floor(Math.random() * cards.length)];
  }

  initBoard() {
    return {
      properties: [
        { id: 0, name: 'GO', type: 'go', price: 0 },
        { id: 1, name: 'Mediterranean Ave', type: 'property', color: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], owner: null, houses: 0 },
        { id: 2, name: 'Community Chest', type: 'chest', price: 0 },
        { id: 3, name: 'Baltic Ave', type: 'property', color: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], owner: null, houses: 0 },
        { id: 4, name: 'Income Tax', type: 'tax', price: 200 },
        { id: 5, name: 'Reading Railroad', type: 'railroad', price: 200, owner: null },
        { id: 6, name: 'Oriental Ave', type: 'property', color: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], owner: null, houses: 0 },
        { id: 7, name: 'Chance', type: 'chance', price: 0 },
        { id: 8, name: 'Vermont Ave', type: 'property', color: 'lightblue', price: 100, rent: [6, 30, 90, 270, 400, 550], owner: null, houses: 0 },
        { id: 9, name: 'Connecticut Ave', type: 'property', color: 'lightblue', price: 120, rent: [8, 40, 100, 300, 450, 600], owner: null, houses: 0 },
        { id: 10, name: 'Jail', type: 'jail', price: 0 },
        { id: 11, name: 'St. Charles Place', type: 'property', color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], owner: null, houses: 0 },
        { id: 12, name: 'Electric Company', type: 'utility', price: 150, owner: null },
        { id: 13, name: 'States Ave', type: 'property', color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], owner: null, houses: 0 },
        { id: 14, name: 'Virginia Ave', type: 'property', color: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900], owner: null, houses: 0 },
        { id: 15, name: 'Pennsylvania Railroad', type: 'railroad', price: 200, owner: null },
        { id: 16, name: 'St. James Place', type: 'property', color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], owner: null, houses: 0 },
        { id: 17, name: 'Community Chest', type: 'chest', price: 0 },
        { id: 18, name: 'Tennessee Ave', type: 'property', color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], owner: null, houses: 0 },
        { id: 19, name: 'New York Ave', type: 'property', color: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000], owner: null, houses: 0 },
        { id: 20, name: 'Free Parking', type: 'parking', price: 0 },
        { id: 21, name: 'Kentucky Ave', type: 'property', color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], owner: null, houses: 0 },
        { id: 22, name: 'Chance', type: 'chance', price: 0 },
        { id: 23, name: 'Indiana Ave', type: 'property', color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], owner: null, houses: 0 },
        { id: 24, name: 'Illinois Ave', type: 'property', color: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100], owner: null, houses: 0 },
        { id: 25, name: 'B&O Railroad', type: 'railroad', price: 200, owner: null },
        { id: 26, name: 'Atlantic Ave', type: 'property', color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], owner: null, houses: 0 },
        { id: 27, name: 'Ventnor Ave', type: 'property', color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], owner: null, houses: 0 },
        { id: 28, name: 'Water Works', type: 'utility', price: 150, owner: null },
        { id: 29, name: 'Marvin Gardens', type: 'property', color: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200], owner: null, houses: 0 },
        { id: 30, name: 'Go To Jail', type: 'gotojail', price: 0 },
        { id: 31, name: 'Pacific Ave', type: 'property', color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], owner: null, houses: 0 },
        { id: 32, name: 'North Carolina Ave', type: 'property', color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], owner: null, houses: 0 },
        { id: 33, name: 'Community Chest', type: 'chest', price: 0 },
        { id: 34, name: 'Pennsylvania Ave', type: 'property', color: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], owner: null, houses: 0 },
        { id: 35, name: 'Short Line', type: 'railroad', price: 200, owner: null },
        { id: 36, name: 'Chance', type: 'chance', price: 0 },
        { id: 37, name: 'Park Place', type: 'property', color: 'darkblue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], owner: null, houses: 0 },
        { id: 38, name: 'Luxury Tax', type: 'tax', price: 100 },
        { id: 39, name: 'Boardwalk', type: 'property', color: 'darkblue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], owner: null, houses: 0 }
      ]
    };
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    const token = this.tokens[this.players.length];
    this.players.push({ ...player, token, position: 0, money: 1500, properties: [], inJail: false, jailTurns: 0 });
    return true;
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      const player = this.players[index];
      this.board.properties.forEach(prop => {
        if (prop.owner === player.id) {
          prop.owner = null;
          prop.houses = 0;
        }
      });
      this.players.splice(index, 1);
      if (this.currentPlayerIndex >= this.players.length) {
        this.currentPlayerIndex = 0;
      }
      return true;
    }
    return false;
  }

  startGame() {
    if (this.players.length >= 2) {
      this.status = 'playing';
      this.currentPlayerIndex = 0;
      this.startTurnTimer();
      return true;
    }
    return false;
  }

  startTurnTimer() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
    }
    this.turnStartTime = Date.now();
    this.turnTimeout = setTimeout(() => {
      this.handleTurnTimeout();
    }, this.turnTimeoutDuration);
  }

  handleTurnTimeout() {
    if (this.status !== 'playing') return;
    
    // Auto-advance turn
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.diceValue = [0, 0];
    
    // Notify players
    io.to(this.gameId).emit('turn_timeout', {
      skippedPlayerIndex: (this.currentPlayerIndex - 1 + this.players.length) % this.players.length,
      gameState: this.getState()
    });
    
    this.startTurnTimer();
  }

  rollDice() {
    this.diceValue = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
    return this.diceValue;
  }

  movePlayer(playerIndex) {
    if (playerIndex !== this.currentPlayerIndex) return { success: false };
    const player = this.players[playerIndex];
    const totalMove = this.diceValue[0] + this.diceValue[1];
    const oldPosition = player.position;
    player.position = (player.position + totalMove) % 40;
    
    if (player.position < oldPosition) {
      player.money += 200;
    }
    
    const landedOn = this.board.properties[player.position];
    let action = null;

    if (landedOn.type === 'property' || landedOn.type === 'railroad' || landedOn.type === 'utility') {
      if (landedOn.owner === null) {
        action = { type: 'can_buy', property: landedOn };
      } else if (landedOn.owner !== player.id) {
        const rent = this.calculateRent(landedOn);
        player.money -= rent;
        const owner = this.players.find(p => p.id === landedOn.owner);
        if (owner) owner.money += rent;
        action = { type: 'paid_rent', property: landedOn, rent };
      }
    } else if (landedOn.type === 'tax') {
      player.money -= landedOn.price;
      action = { type: 'paid_tax', amount: landedOn.price };
    } else if (landedOn.type === 'gotojail') {
      player.position = 10;
      player.inJail = true;
      action = { type: 'went_to_jail' };
    } else if (landedOn.type === 'chance') {
      const card = this.drawCard('chance');
      player.money += card.effect;
      action = { type: 'drew_card', cardType: 'chance', card };
    } else if (landedOn.type === 'chest') {
      const card = this.drawCard('chest');
      player.money += card.effect;
      action = { type: 'drew_card', cardType: 'chest', card };
    }

    if (this.diceValue[0] !== this.diceValue[1]) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      this.startTurnTimer();
    }

    if (player.money < 0) {
      this.handleBankruptcy(player);
    }

    this.diceValue = [0, 0];
    return { success: true, player, landedOn, action };
  }

  calculateRent(property) {
    if (property.type === 'railroad') {
      const railroadsOwned = this.board.properties.filter(p => p.type === 'railroad' && p.owner === property.owner).length;
      return 25 * Math.pow(2, railroadsOwned - 1);
    }
    if (property.type === 'utility') {
      const utilitiesOwned = this.board.properties.filter(p => p.type === 'utility' && p.owner === property.owner).length;
      const diceTotal = this.diceValue[0] + this.diceValue[1];
      return utilitiesOwned === 1 ? diceTotal * 4 : diceTotal * 10;
    }
    return property.rent[property.houses];
  }

  buyProperty(playerIndex, propertyId) {
    const player = this.players[playerIndex];
    const property = this.board.properties[propertyId];
    if (!property || property.owner !== null || player.money < property.price) {
      return { success: false };
    }
    player.money -= property.price;
    property.owner = player.id;
    player.properties.push(propertyId);
    return { success: true, property };
  }

  handleBankruptcy(player) {
    player.properties.forEach(propId => {
      const prop = this.board.properties[propId];
      if (prop) {
        prop.owner = null;
        prop.houses = 0;
      }
    });
    player.properties = [];
    player.bankrupt = true;
    
    const activePlayers = this.players.filter(p => !p.bankrupt);
    if (activePlayers.length === 1) {
      this.status = 'finished';
      return activePlayers[0];
    }
    return null;
  }

  getState() {
    return {
      gameId: this.gameId,
      type: this.type,
      status: this.status,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        token: p.token,
        position: p.position,
        money: p.money,
        properties: p.properties,
        inJail: p.inJail,
        bankrupt: p.bankrupt,
        avatar: p.avatar
      })),
      board: this.board,
      currentPlayerIndex: this.currentPlayerIndex,
      diceValue: this.diceValue,
      maxPlayers: this.maxPlayers
    };
  }
}

class UnoGame {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.maxPlayers = 10;
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.status = 'waiting';
    this.type = 'uno';
    this.deck = [];
    this.discardPile = [];
    this.currentColor = null;
    this.turnTimeout = null;
    this.turnStartTime = null;
    this.turnTimeoutDuration = 45000; // 45 seconds for UNO
  }

  initDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const deck = [];
    
    colors.forEach(color => {
      deck.push({ color, value: '0' });
      for (let i = 1; i <= 9; i++) {
        deck.push({ color, value: String(i) });
        deck.push({ color, value: String(i) });
      }
      ['skip', 'reverse', 'draw2'].forEach(special => {
        deck.push({ color, value: special });
        deck.push({ color, value: special });
      });
    });
    
    for (let i = 0; i < 4; i++) {
      deck.push({ color: 'wild', value: 'wild' });
      deck.push({ color: 'wild', value: 'wild4' });
    }
    
    return this.shuffle(deck);
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    this.players.push({ ...player, hand: [], uno: false });
    return true;
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      const player = this.players[index];
      this.deck.push(...player.hand);
      this.players.splice(index, 1);
      if (this.currentPlayerIndex >= this.players.length) {
        this.currentPlayerIndex = 0;
      }
      return true;
    }
    return false;
  }

  startGame() {
    if (this.players.length >= 2) {
      this.deck = this.initDeck();
      this.players.forEach(player => {
        player.hand = this.deck.splice(0, 7);
      });
      
      let startCard = this.deck.pop();
      while (startCard.color === 'wild') {
        this.deck.unshift(startCard);
        this.deck = this.shuffle(this.deck);
        startCard = this.deck.pop();
      }
      this.discardPile = [startCard];
      this.currentColor = startCard.color;
      
      this.status = 'playing';
      this.currentPlayerIndex = 0;
      this.startTurnTimer();
      return true;
    }
    return false;
  }

  startTurnTimer() {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
    }
    this.turnStartTime = Date.now();
    this.turnTimeout = setTimeout(() => {
      this.handleTurnTimeout();
    }, this.turnTimeoutDuration);
  }

  handleTurnTimeout() {
    if (this.status !== 'playing') return;
    
    // Auto-draw a card and advance turn
    const player = this.players[this.currentPlayerIndex];
    if (this.deck.length === 0) this.reshuffleDeck();
    if (this.deck.length > 0) {
      player.hand.push(this.deck.pop());
    }
    
    this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    
    // Notify players
    io.to(this.gameId).emit('turn_timeout', {
      skippedPlayerIndex: (this.currentPlayerIndex - 1 + this.players.length) % this.players.length,
      gameState: this.getState()
    });
    
    this.startTurnTimer();
  }

  canPlayCard(card) {
    const topCard = this.discardPile[this.discardPile.length - 1];
    if (card.color === 'wild') return true;
    if (card.color === this.currentColor) return true;
    if (card.value === topCard.value) return true;
    return false;
  }

  playCard(playerIndex, cardIndex, chosenColor = null) {
    if (playerIndex !== this.currentPlayerIndex) return { success: false };
    
    const player = this.players[playerIndex];
    const card = player.hand[cardIndex];
    if (!card || !this.canPlayCard(card)) return { success: false };
    
    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    
    if (card.color === 'wild') {
      this.currentColor = chosenColor || 'red';
    } else {
      this.currentColor = card.color;
    }
    
    let nextPlayerIndex = this.currentPlayerIndex;
    let drawCards = 0;
    let skipNext = false;

    if (card.value === 'reverse') {
      this.direction *= -1;
      if (this.players.length === 2) skipNext = true;
    } else if (card.value === 'skip') {
      skipNext = true;
    } else if (card.value === 'draw2') {
      skipNext = true;
      drawCards = 2;
    } else if (card.value === 'wild4') {
      skipNext = true;
      drawCards = 4;
    }

    nextPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
    
    if (drawCards > 0) {
      const targetPlayer = this.players[nextPlayerIndex];
      for (let i = 0; i < drawCards; i++) {
        if (this.deck.length === 0) this.reshuffleDeck();
        if (this.deck.length > 0) targetPlayer.hand.push(this.deck.pop());
      }
    }

    if (skipNext) {
      nextPlayerIndex = (nextPlayerIndex + this.direction + this.players.length) % this.players.length;
    }

    this.currentPlayerIndex = nextPlayerIndex;

    if (player.hand.length === 0) {
      this.status = 'finished';
      return { success: true, winner: player, card };
    }

    return { success: true, card };
  }

  drawCard(playerIndex) {
    if (playerIndex !== this.currentPlayerIndex) return { success: false };
    
    const player = this.players[playerIndex];
    if (this.deck.length === 0) this.reshuffleDeck();
    if (this.deck.length === 0) return { success: false };
    
    const card = this.deck.pop();
    player.hand.push(card);
    
    if (!this.canPlayCard(card)) {
      this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
      this.startTurnTimer();
    }
    
    return { success: true, card, canPlay: this.canPlayCard(card) };
  }

  reshuffleDeck() {
    if (this.discardPile.length <= 1) return;
    const topCard = this.discardPile.pop();
    this.deck = this.shuffle(this.discardPile);
    this.discardPile = [topCard];
  }

  callUno(playerIndex) {
    const player = this.players[playerIndex];
    if (player.hand.length === 1) {
      player.uno = true;
      return { success: true };
    }
    return { success: false };
  }

  getState() {
    return {
      gameId: this.gameId,
      type: this.type,
      status: this.status,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        handCount: p.hand.length,
        uno: p.uno,
        avatar: p.avatar
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      direction: this.direction,
      topCard: this.discardPile[this.discardPile.length - 1],
      currentColor: this.currentColor,
      deckCount: this.deck.length,
      maxPlayers: this.maxPlayers
    };
  }

  getPlayerHand(playerId) {
    const player = this.players.find(p => p.id === playerId);
    return player ? player.hand : [];
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  let currentUser = null;
  let currentGameId = null;

  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, SECRET);
      const result = await pool.query(
        'SELECT id, username, avatar, coins, wins FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length > 0) {
        currentUser = { ...result.rows[0], socketId: socket.id };
        socket.emit('authenticated', currentUser);
        
        // Check for active games this user was in
        const activeGameIds = [];
        activeGames.forEach((game, gameId) => {
          const playerInGame = game.players.find(p => p.id === currentUser.id);
          if (playerInGame) {
            // Update socket ID for reconnection
            playerInGame.socketId = socket.id;
            activeGameIds.push(gameId);
            socket.join(gameId);
            // Send current game state
            socket.emit('game_state', game.getState());
          }
        });
        
        if (activeGameIds.length > 0) {
          socket.emit('reconnected_to_games', activeGameIds);
        }
      }
    } catch (err) {
      socket.emit('auth_error', 'Invalid token');
    }
  });

  socket.on('reconnect_to_game', (gameId) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    const game = activeGames.get(gameId);
    if (!game) {
      socket.emit('error', 'Game not found');
      return;
    }

    const playerInGame = game.players.find(p => p.id === currentUser.id);
    if (!playerInGame) {
      socket.emit('error', 'Not a player in this game');
      return;
    }

    // Update socket ID
    playerInGame.socketId = socket.id;
    currentGameId = gameId;
    if (redisClient) redisClient.setUserActiveGame(currentUser.id, gameId);
    socket.join(gameId);
    
    // Send current game state
    const state = game.getState();
    if (game.type === 'uno') {
      state.hand = game.getPlayerHand(currentUser.id);
    }
    socket.emit('game_state', state);
    
    // Notify other players
    socket.to(gameId).emit('player_reconnected', {
      playerId: currentUser.id,
      username: currentUser.username,
      gameState: state
    });
  });

  socket.on('create_game', (gameType) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    const gameId = uuidv4();
    let game;

    if (gameType === 'ludo') {
      game = new LudoGame(gameId);
    } else if (gameType === 'monopoly') {
      game = new MonopolyGame(gameId);
    } else if (gameType === 'uno') {
      game = new UnoGame(gameId);
    } else {
      socket.emit('error', 'Invalid game type');
      return;
    }

    game.addPlayer(currentUser);
    activeGames.set(gameId, game);
    currentGameId = gameId;
    if (redisClient) redisClient.setUserActiveGame(currentUser.id, gameId);
    socket.join(gameId);
    socket.emit('game_created', game.getState());
    io.emit('games_updated', getActiveGamesList());
  });

  socket.on('join_game', (gameId) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    const game = activeGames.get(gameId);
    if (!game) {
      socket.emit('error', 'Game not found');
      return;
    }

    if (game.status !== 'waiting') {
      socket.emit('error', 'Game already started');
      return;
    }

    if (!game.addPlayer(currentUser)) {
      socket.emit('error', 'Game is full');
      return;
    }

    currentGameId = gameId;
    if (redisClient) redisClient.setUserActiveGame(currentUser.id, gameId);
    socket.join(gameId);
    io.to(gameId).emit('game_state', game.getState());
    io.emit('games_updated', getActiveGamesList());
  });

  socket.on('quick_match', (gameType, theme) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    for (const [gameId, game] of activeGames) {
      if (game.type === gameType && game.status === 'waiting' && game.players.length < game.maxPlayers) {
        game.addPlayer(currentUser);
        currentGameId = gameId;
        if (redisClient) redisClient.setUserActiveGame(currentUser.id, gameId);
        socket.join(gameId);
        const state = game.getState();
        if (game.type === 'uno') {
          state.hand = game.getPlayerHand(currentUser.id);
        }
        io.to(gameId).emit('game_state', state);
        io.emit('games_updated', getActiveGamesList());
        return;
      }
    }

    const gameId = uuidv4();
    let game;
    if (gameType === 'ludo') {
      game = new LudoGame(gameId);
      if (theme) game.theme = theme;
    } else if (gameType === 'monopoly') {
      game = new MonopolyGame(gameId);
    } else if (gameType === 'uno') {
      game = new UnoGame(gameId);
    } else {
      socket.emit('error', 'Invalid game type');
      return;
    }

    game.addPlayer(currentUser);
    activeGames.set(gameId, game);
    currentGameId = gameId;
    if (redisClient) redisClient.setUserActiveGame(currentUser.id, gameId);
    socket.join(gameId);
    socket.emit('game_created', game.getState());
    io.emit('games_updated', getActiveGamesList());
  });

  socket.on('start_game', () => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game) return;

    if (game.players[0]?.socketId !== socket.id) {
      socket.emit('error', 'Only host can start the game');
      return;
    }

    if (game.startGame()) {
      io.to(currentGameId).emit('game_started', game.getState());
    } else {
      socket.emit('error', 'Need at least 2 players to start');
    }
  });

  socket.on('roll_dice', () => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== game.currentPlayerIndex) {
      socket.emit('error', 'Not your turn');
      return;
    }

    if (game.diceValue !== null) {
      socket.emit('error', 'Already rolled');
      return;
    }

    const diceValue = game.rollDice();
    io.to(currentGameId).emit('dice_rolled', { 
      diceValue, 
      playerIndex,
      gameState: game.getState()
    });
  });

  socket.on('move_piece', (pieceIndex) => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.movePiece(playerIndex, pieceIndex);

    if (result.success) {
      io.to(currentGameId).emit('piece_moved', {
        playerIndex,
        pieceIndex,
        newPos: result.newPos,
        captured: result.captured,
        gameState: game.getState()
      });

      if (result.winner) {
        io.to(currentGameId).emit('game_over', {
          winner: result.winner,
          gameState: game.getState()
        });
        
        updatePlayerStats(result.winner.id, true);
        game.players.forEach(p => {
          if (p.id !== result.winner.id) {
            updatePlayerStats(p.id, false);
          }
        });
        
        saveGameHistory(currentGameId, game, result.winner.id);
      }
    } else {
      socket.emit('invalid_move');
    }
  });

  socket.on('monopoly_roll', () => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'monopoly' || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== game.currentPlayerIndex) {
      socket.emit('error', 'Not your turn');
      return;
    }

    const diceValue = game.rollDice();
    const result = game.movePlayer(playerIndex);

    io.to(currentGameId).emit('monopoly_moved', {
      diceValue,
      result,
      gameState: game.getState()
    });

    if (game.status === 'finished') {
      const winner = game.players.find(p => !p.bankrupt);
      if (winner) {
        io.to(currentGameId).emit('game_over', { winner, gameState: game.getState() });
        updatePlayerStats(winner.id, true);
        game.players.forEach(p => {
          if (p.id !== winner.id) updatePlayerStats(p.id, false);
        });
        saveGameHistory(currentGameId, game, winner.id);
      } else {
        console.error('Game finished but no winner found');
        io.to(currentGameId).emit('game_over', { winner: null, gameState: game.getState() });
      }
    }
  });

  socket.on('monopoly_buy', (propertyId) => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'monopoly' || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.buyProperty(playerIndex, propertyId);

    if (result.success) {
      const player = game.players[playerIndex];
      io.to(currentGameId).emit('monopoly_bought', {
        playerIndex,
        property: result.property,
        buyerId: player.id,
        gameState: game.getState()
      });
    } else {
      socket.emit('error', 'Cannot buy property');
    }
  });

  socket.on('uno_play_card', (cardIndex, chosenColor) => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'uno' || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.playCard(playerIndex, cardIndex, chosenColor);

    if (result.success) {
      const state = game.getState();
      io.to(currentGameId).emit('uno_card_played', {
        playerIndex,
        card: result.card,
        gameState: state
      });

      game.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.socketId);
        if (playerSocket) {
          playerSocket.emit('uno_hand', game.getPlayerHand(p.id));
        }
      });

      if (result.winner) {
        io.to(currentGameId).emit('game_over', { winner: result.winner, gameState: state });
        updatePlayerStats(result.winner.id, true);
        game.players.forEach(p => {
          if (p.id !== result.winner.id) updatePlayerStats(p.id, false);
        });
        saveGameHistory(currentGameId, game, result.winner.id);
      }
    } else {
      socket.emit('error', 'Invalid card play');
    }
  });

  socket.on('uno_draw_card', () => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'uno' || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.drawCard(playerIndex);

    if (result.success) {
      socket.emit('uno_drew_card', { card: result.card, canPlay: result.canPlay });
      socket.emit('uno_hand', game.getPlayerHand(currentUser.id));
      io.to(currentGameId).emit('uno_player_drew', {
        playerIndex,
        gameState: game.getState()
      });
    }
  });

  socket.on('uno_call_uno', () => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'uno') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.callUno(playerIndex);

    if (result.success) {
      io.to(currentGameId).emit('uno_called', { playerIndex, gameState: game.getState() });
    }
  });

  socket.on('send_message', (message) => {
    if (!currentGameId || !currentUser) return;
    io.to(currentGameId).emit('chat_message', {
      user: currentUser.username,
      message,
      timestamp: Date.now()
    });
  });

  socket.on('send_sticker', (sticker) => {
    if (!currentGameId || !currentUser) return;
    io.to(currentGameId).emit('sticker_received', {
      sticker,
      username: currentUser.username
    });
  });

  socket.on('join_as_spectator', (gameId) => {
    if (!currentUser) return;
    const game = activeGames.get(gameId);
    if (!game) return;
    
    if (!game.spectators) game.spectators = [];
    game.spectators.push({ id: currentUser.id, username: currentUser.username, socketId: socket.id });
    socket.join(gameId);
    currentGameId = gameId;
    
    socket.emit('spectator_joined', { gameState: game.getState() });
    io.to(gameId).emit('spectators_updated', game.spectators);
    
    const playerCount = game.players.length;
    io.to(gameId).emit('room_status_updated', { players: playerCount, spectators: game.spectators.length });
  });

  socket.on('join_voice', () => {
    if (!currentGameId || !currentUser) return;
    const game = activeGames.get(currentGameId);
    if (!game) return;
    
    if (!game.voiceParticipants) game.voiceParticipants = [];
    if (!game.voiceParticipants.find(p => p.id === currentUser.id)) {
      game.voiceParticipants.push({ id: currentUser.id, username: currentUser.username, speaking: false });
    }
    io.to(currentGameId).emit('voice_participants_updated', game.voiceParticipants);
  });

  socket.on('leave_voice', () => {
    if (!currentGameId || !currentUser) return;
    const game = activeGames.get(currentGameId);
    if (!game || !game.voiceParticipants) return;
    
    game.voiceParticipants = game.voiceParticipants.filter(p => p.id !== currentUser.id);
    io.to(currentGameId).emit('voice_participants_updated', game.voiceParticipants);
  });

  socket.on('monopoly_buy_building', (propertyId) => {
    try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:monopoly_buy_building:entry',message:'monopoly_buy_building entry',data:{currentGameId,propertyId,gameType:activeGames.get(currentGameId)?.type,hasGame:!!activeGames.get(currentGameId)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    if (!currentGameId || !currentUser) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'monopoly') return;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:before_properties_find',message:'before game.board.properties find',data:{hasGameProperties:typeof game.properties!=='undefined',hasBoardProperties:!!(game.board&&game.board.properties)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    const property = game.board.properties.find(p => p.id === propertyId);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:after_properties_find',message:'after property find',data:{propertyFound:!!property,propertyId:property?.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    if (!property || property.owner !== currentUser.id) return;

    const player = game.players.find(p => p.id === currentUser.id);
    if (!player) return;

    if (property.type !== 'property') return;

    const houseCost = property.price / 2;
    const currentHouses = property.houses || 0;

    if (currentHouses >= 5 || player.money < houseCost) return;

    player.money -= houseCost;
    property.houses = currentHouses + 1;

    io.to(currentGameId).emit('monopoly_building_bought', {
      propertyId,
      houses: property.houses,
      gameState: game.getState()
    });
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:monopoly_buy_building:catch',message:'monopoly_buy_building threw',data:{errName:err.name,errMessage:err.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      socket.emit('error', err.message || 'Failed to buy building');
    }
  });

  socket.on('leave_game', () => {
    if (currentGameId) {
      const game = activeGames.get(currentGameId);
      if (game) {
        game.removePlayer(socket.id);
        socket.leave(currentGameId);
        
        if (game.players.length === 0) {
          activeGames.delete(currentGameId);
        } else {
          io.to(currentGameId).emit('player_left', {
            gameState: game.getState()
          });
        }
        io.emit('games_updated', getActiveGamesList());
      }
      if (currentUser && redisClient) redisClient.setUserActiveGame(currentUser.id, null);
      currentGameId = null;
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (currentGameId) {
      const game = activeGames.get(currentGameId);
      if (game) {
        game.removePlayer(socket.id);
        if (game.players.length === 0) {
          activeGames.delete(currentGameId);
        } else {
          io.to(currentGameId).emit('player_left', {
            gameState: game.getState()
          });
        }
        io.emit('games_updated', getActiveGamesList());
      }
    }
  });
});

async function updatePlayerStats(userId, won) {
  try {
    if (won) {
      await pool.query(
        'UPDATE users SET wins = wins + 1, games_played = games_played + 1 WHERE id = $1',
        [userId]
      );
    } else {
      await pool.query(
        'UPDATE users SET games_played = games_played + 1 WHERE id = $1',
        [userId]
      );
    }
  } catch (err) {
    console.error('Error updating player stats:', err);
  }
}

async function saveGameHistory(gameId, game, winnerId) {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:saveGameHistory:entry',message:'saveGameHistory entry',data:{gameType:game.type,playerCount:game.players.length,firstPlayerHasColor:game.players[0]?.color!==undefined,firstPlayerHasToken:game.players[0]?.token!==undefined},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    // Map players with game-type-specific fields
    const playersData = game.players.map(p => {
      const base = { id: p.id, username: p.username };
      if (game.type === 'ludo' && p.color) {
        base.color = p.color;
      } else if (game.type === 'monopoly' && p.token) {
        base.token = p.token;
      }
      return base;
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/85d4d97e-6e72-4c83-83cb-0bd0ffb003dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.js:saveGameHistory:before_query',message:'before query with mapped players',data:{playersDataLength:playersData.length,firstPlayerData:playersData[0]},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    await pool.query(
      `INSERT INTO games (id, game_type, status, players, game_state, winner_id, ended_at)
       VALUES ($1, $2, 'finished', $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'finished', winner_id = $5, ended_at = NOW()`,
      [gameId, game.type, JSON.stringify(playersData), JSON.stringify(game.getState()), winnerId]
    );

    for (const player of game.players) {
      const result = player.id === winnerId ? 'win' : 'loss';
      await pool.query(
        `INSERT INTO game_history (game_id, user_id, game_type, result, played_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [gameId, player.id, game.type, result]
      );
    }
    if (redisClient) await redisClient.invalidateLeaderboardCache(game.type);
  } catch (err) {
    console.error('Error saving game history:', err);
  }
}

function getActiveGamesList() {
  const games = [];
  activeGames.forEach((game, id) => {
    if (game.status === 'waiting') {
      games.push({
        id,
        type: game.type,
        players: game.players.length,
        maxPlayers: game.maxPlayers,
        host: game.players[0]?.username
      });
    }
  });
  return games;
}

// REST game endpoints (plan §4) – POST /games/create, /games/:id/join, /games/:id/leave
async function getUserFromAuth(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    const result = await pool.query(
      'SELECT id, username, avatar, coins, wins FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return null;
    }
    return { ...result.rows[0], socketId: null };
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}

app.post('/api/games/create', async (req, res) => {
  const user = await getUserFromAuth(req, res);
  if (!user) return;
  const { gameType } = req.body;
  if (!gameType || !['ludo', 'monopoly', 'uno'].includes(gameType)) {
    return res.status(400).json({ error: 'Invalid gameType. Use ludo, monopoly, or uno' });
  }
  const gameId = uuidv4();
  let game;
  if (gameType === 'ludo') {
    game = new LudoGame(gameId);
  } else if (gameType === 'monopoly') {
    game = new MonopolyGame(gameId);
  } else {
    game = new UnoGame(gameId);
  }
  game.addPlayer(user);
  activeGames.set(gameId, game);
  if (redisClient) redisClient.setUserActiveGame(user.id, gameId);
  io.emit('games_updated', getActiveGamesList());
  res.status(201).json({ gameId, gameState: game.getState() });
});

app.post('/api/games/:gameId/join', async (req, res) => {
  const user = await getUserFromAuth(req, res);
  if (!user) return;
  const { gameId } = req.params;
  const game = activeGames.get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  if (game.status !== 'waiting') {
    return res.status(400).json({ error: 'Game already started' });
  }
  if (!game.addPlayer(user)) {
    return res.status(400).json({ error: 'Game is full' });
  }
  if (redisClient) redisClient.setUserActiveGame(user.id, gameId);
  io.to(gameId).emit('game_state', game.getState());
  io.emit('games_updated', getActiveGamesList());
  res.json({ gameId, gameState: game.getState() });
});

app.post('/api/games/:gameId/leave', async (req, res) => {
  const user = await getUserFromAuth(req, res);
  if (!user) return;
  const { gameId } = req.params;
  const game = activeGames.get(gameId);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }
  const idx = game.players.findIndex(p => p.id === user.id);
  if (idx !== -1) {
    game.players.splice(idx, 1);
    if (game.currentPlayerIndex >= game.players.length) {
      game.currentPlayerIndex = 0;
    }
  } else {
    game.removePlayer(user.socketId);
  }
  if (game.players.length === 0) {
    activeGames.delete(gameId);
  } else {
    io.to(gameId).emit('player_left', { gameState: game.getState() });
  }
  if (redisClient) redisClient.setUserActiveGame(user.id, null);
  io.emit('games_updated', getActiveGamesList());
  res.json({ success: true });
});

const PORT = process.env.PORT || 5000;

async function start() {
  await initDatabase();
  await redisClient.connectRedis();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
