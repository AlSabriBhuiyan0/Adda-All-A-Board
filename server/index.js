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
      return true;
    }
    return false;
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
    }

    if (this.diceValue[0] !== this.diceValue[1]) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
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
      return true;
    }
    return false;
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

  socket.on('quick_match', (gameType, theme) => {
    if (!currentUser) {
      socket.emit('error', 'Not authenticated');
      return;
    }

    for (const [gameId, game] of activeGames) {
      if (game.type === gameType && game.status === 'waiting' && game.players.length < game.maxPlayers) {
        game.addPlayer(currentUser);
        currentGameId = gameId;
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
      io.to(currentGameId).emit('game_over', { winner, gameState: game.getState() });
      updatePlayerStats(winner.id, true);
      game.players.forEach(p => {
        if (p.id !== winner.id) updatePlayerStats(p.id, false);
      });
      saveGameHistory(currentGameId, game, winner.id);
    }
  });

  socket.on('monopoly_buy', (propertyId) => {
    if (!currentGameId) return;
    const game = activeGames.get(currentGameId);
    if (!game || game.type !== 'monopoly' || game.status !== 'playing') return;

    const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
    const result = game.buyProperty(playerIndex, propertyId);

    if (result.success) {
      io.to(currentGameId).emit('monopoly_bought', {
        playerIndex,
        property: result.property,
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
