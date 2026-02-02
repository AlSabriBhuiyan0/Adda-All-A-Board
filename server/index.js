const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: SESSION_SECRET not set. Using temporary secret for development only.');
}
const SECRET = JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

const activeGames = new Map();
const waitingPlayers = new Map();

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar VARCHAR(20) DEFAULT 'default',
        coins INT DEFAULT 100,
        wins INT DEFAULT 0,
        games_played INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS games (
        id UUID PRIMARY KEY,
        game_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'waiting',
        players JSONB DEFAULT '[]',
        game_state JSONB DEFAULT '{}',
        winner_id INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS game_history (
        id SERIAL PRIMARY KEY,
        game_id UUID REFERENCES games(id),
        user_id INT REFERENCES users(id),
        game_type VARCHAR(20) NOT NULL,
        result VARCHAR(20),
        score INT DEFAULT 0,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        friend_id INT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, friend_id)
      );

      CREATE TABLE IF NOT EXISTS leaderboard (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) UNIQUE,
        game_type VARCHAR(20),
        score INT DEFAULT 0,
        rank INT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    client.release();
  }
}

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

app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, wins, games_played, avatar FROM users ORDER BY wins DESC LIMIT 50'
    );
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
      return true;
    }
    return false;
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
      }
    } catch (err) {
      socket.emit('auth_error', 'Invalid token');
    }
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
    } else {
      socket.emit('error', 'Invalid game type');
      return;
    }

    game.addPlayer(currentUser);
    activeGames.set(gameId, game);
    currentGameId = gameId;
    
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
    socket.join(gameId);
    io.to(gameId).emit('game_state', game.getState());
    io.emit('games_updated', getActiveGamesList());
  });

  socket.on('quick_match', (gameType) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    for (const [gameId, game] of activeGames) {
      if (game.type === gameType && game.status === 'waiting' && game.players.length < game.maxPlayers) {
        game.addPlayer(currentUser);
        currentGameId = gameId;
        socket.join(gameId);
        io.to(gameId).emit('game_state', game.getState());
        io.emit('games_updated', getActiveGamesList());
        return;
      }
    }

    const gameId = uuidv4();
    let game;
    if (gameType === 'ludo') {
      game = new LudoGame(gameId);
    } else {
      socket.emit('error', 'Invalid game type');
      return;
    }

    game.addPlayer(currentUser);
    activeGames.set(gameId, game);
    currentGameId = gameId;
    
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

  socket.on('send_message', (message) => {
    if (!currentGameId || !currentUser) return;
    io.to(currentGameId).emit('chat_message', {
      user: currentUser.username,
      message,
      timestamp: Date.now()
    });
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
    await pool.query(
      `INSERT INTO games (id, game_type, status, players, game_state, winner_id, ended_at)
       VALUES ($1, $2, 'finished', $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'finished', winner_id = $5, ended_at = NOW()`,
      [gameId, game.type, JSON.stringify(game.players.map(p => ({ id: p.id, username: p.username, color: p.color }))), JSON.stringify(game.getState()), winnerId]
    );

    for (const player of game.players) {
      const result = player.id === winnerId ? 'win' : 'loss';
      await pool.query(
        `INSERT INTO game_history (game_id, user_id, game_type, result, played_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [gameId, player.id, game.type, result]
      );
    }
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

const PORT = 5000;

initDatabase().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
});
