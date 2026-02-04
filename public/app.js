const socket = io();

let currentUser = null;
let currentGame = null;
let authToken = localStorage.getItem('gameToken');
let selectedTheme = localStorage.getItem('gameTheme') || 'classic';
let ownedDeeds = [];
let isSpectator = false;
let voiceConnected = false;

const LUDO_PATH_MAP = {
  topRow: [
    { pos: 13, row: 1, col: 4 }, { pos: 12, row: 1, col: 5 }, { pos: 11, row: 1, col: 6 },
    { pos: 14, row: 2, col: 4, homeStretch: 'green' }, { pos: -1, row: 2, col: 5 }, { pos: 10, row: 2, col: 6 },
    { pos: 15, row: 3, col: 4, homeStretch: 'green' }, { pos: -1, row: 3, col: 5 }, { pos: 9, row: 3, col: 6 }
  ],
  leftCol: [
    { pos: 6, row: 4, col: 1 }, { pos: 5, row: 4, col: 2 }, { pos: 4, row: 4, col: 3 },
    { pos: 7, row: 5, col: 1 }, { pos: 51, row: 5, col: 2, homeStretch: 'red' }, { pos: 52, row: 5, col: 3, homeStretch: 'red' },
    { pos: 8, row: 6, col: 1 }, { pos: 9, row: 6, col: 2 }, { pos: 10, row: 6, col: 3 }
  ],
  rightCol: [
    { pos: 19, row: 4, col: 7 }, { pos: 20, row: 4, col: 8 }, { pos: 21, row: 4, col: 9 },
    { pos: 55, row: 5, col: 7, homeStretch: 'green' }, { pos: 56, row: 5, col: 8, homeStretch: 'green' }, { pos: 22, row: 5, col: 9 },
    { pos: 17, row: 6, col: 7 }, { pos: 18, row: 6, col: 8 }, { pos: 19, row: 6, col: 9 }
  ],
  bottomRow: [
    { pos: 32, row: 7, col: 4, homeStretch: 'yellow' }, { pos: -1, row: 7, col: 5 }, { pos: 24, row: 7, col: 6 },
    { pos: 31, row: 8, col: 4, homeStretch: 'yellow' }, { pos: -1, row: 8, col: 5 }, { pos: 25, row: 8, col: 6 },
    { pos: 30, row: 9, col: 4 }, { pos: 29, row: 9, col: 5 }, { pos: 28, row: 9, col: 6 }
  ]
};

const LUDO_POSITIONS = [];
for (let i = 0; i < 52; i++) LUDO_POSITIONS[i] = { type: 'path', index: i };

const START_POSITIONS = { red: 1, blue: 14, green: 27, yellow: 40 };
const SAFE_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];

const MONOPOLY_PROPERTIES = [
  { id: 0, name: 'GO', type: 'go', price: 0 },
  { id: 1, name: 'Mediterranean Ave', type: 'property', color: 'brown', price: 60 },
  { id: 2, name: 'Community Chest', type: 'chest', price: 0 },
  { id: 3, name: 'Baltic Ave', type: 'property', color: 'brown', price: 60 },
  { id: 4, name: 'Income Tax', type: 'tax', price: 200 },
  { id: 5, name: 'Reading Railroad', type: 'railroad', price: 200 },
  { id: 6, name: 'Oriental Ave', type: 'property', color: 'lightblue', price: 100 },
  { id: 7, name: 'Chance', type: 'chance', price: 0 },
  { id: 8, name: 'Vermont Ave', type: 'property', color: 'lightblue', price: 100 },
  { id: 9, name: 'Connecticut Ave', type: 'property', color: 'lightblue', price: 120 },
  { id: 10, name: 'Jail', type: 'jail', price: 0 },
  { id: 11, name: 'St. Charles Place', type: 'property', color: 'pink', price: 140 },
  { id: 12, name: 'Electric Company', type: 'utility', price: 150 },
  { id: 13, name: 'States Ave', type: 'property', color: 'pink', price: 140 },
  { id: 14, name: 'Virginia Ave', type: 'property', color: 'pink', price: 160 },
  { id: 15, name: 'Pennsylvania Railroad', type: 'railroad', price: 200 },
  { id: 16, name: 'St. James Place', type: 'property', color: 'orange', price: 180 },
  { id: 17, name: 'Community Chest', type: 'chest', price: 0 },
  { id: 18, name: 'Tennessee Ave', type: 'property', color: 'orange', price: 180 },
  { id: 19, name: 'New York Ave', type: 'property', color: 'orange', price: 200 },
  { id: 20, name: 'Free Parking', type: 'parking', price: 0 },
  { id: 21, name: 'Kentucky Ave', type: 'property', color: 'red', price: 220 },
  { id: 22, name: 'Chance', type: 'chance', price: 0 },
  { id: 23, name: 'Indiana Ave', type: 'property', color: 'red', price: 220 },
  { id: 24, name: 'Illinois Ave', type: 'property', color: 'red', price: 240 },
  { id: 25, name: 'B&O Railroad', type: 'railroad', price: 200 },
  { id: 26, name: 'Atlantic Ave', type: 'property', color: 'yellow', price: 260 },
  { id: 27, name: 'Ventnor Ave', type: 'property', color: 'yellow', price: 260 },
  { id: 28, name: 'Water Works', type: 'utility', price: 150 },
  { id: 29, name: 'Marvin Gardens', type: 'property', color: 'yellow', price: 280 },
  { id: 30, name: 'Go To Jail', type: 'gotojail', price: 0 },
  { id: 31, name: 'Pacific Ave', type: 'property', color: 'green', price: 300 },
  { id: 32, name: 'North Carolina Ave', type: 'property', color: 'green', price: 300 },
  { id: 33, name: 'Community Chest', type: 'chest', price: 0 },
  { id: 34, name: 'Pennsylvania Ave', type: 'property', color: 'green', price: 320 },
  { id: 35, name: 'Short Line', type: 'railroad', price: 200 },
  { id: 36, name: 'Chance', type: 'chance', price: 0 },
  { id: 37, name: 'Park Place', type: 'property', color: 'darkblue', price: 350 },
  { id: 38, name: 'Luxury Tax', type: 'tax', price: 100 },
  { id: 39, name: 'Boardwalk', type: 'property', color: 'darkblue', price: 400 }
];

const PLAYER_TOKENS = {
  car: { icon: '🚗', name: 'Car' },
  hat: { icon: '🎩', name: 'Top Hat' },
  dog: { icon: '🐕', name: 'Dog' },
  ship: { icon: '🚢', name: 'Ship' },
  boot: { icon: '👢', name: 'Boot' },
  thimble: { icon: '🛡️', name: 'Thimble' }
};

const PROPERTY_COLORS = {
  brown: '#8B4513',
  lightblue: '#87CEEB',
  pink: '#FF69B4',
  orange: '#FFA500',
  red: '#FF0000',
  yellow: '#FFFF00',
  green: '#228B22',
  darkblue: '#00008B'
};

function setTheme(theme) {
  selectedTheme = theme;
  localStorage.setItem('gameTheme', theme);
  document.body.className = '';
  if (theme !== 'classic') {
    document.body.classList.add(`theme-${theme}`);
  }
}

document.getElementById('ludo-theme')?.addEventListener('change', (e) => {
  setTheme(e.target.value);
});

if (selectedTheme !== 'classic') {
  setTheme(selectedTheme);
  const themeSelect = document.getElementById('ludo-theme');
  if (themeSelect) themeSelect.value = selectedTheme;
}

const screens = {
  auth: document.getElementById('auth-screen'),
  lobby: document.getElementById('lobby-screen'),
  waiting: document.getElementById('waiting-room'),
  game: document.getElementById('game-screen')
};

function showScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    if (res.ok) {
      handleAuthSuccess(data);
    } else {
      showError(data.error);
    }
  } catch (err) {
    showError('Connection error');
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    
    const data = await res.json();
    if (res.ok) {
      handleAuthSuccess(data);
    } else {
      showError(data.error);
    }
  } catch (err) {
    showError('Connection error');
  }
});

function handleAuthSuccess(data) {
  currentUser = data.user;
  authToken = data.token;
  localStorage.setItem('gameToken', authToken);
  
  socket.emit('authenticate', authToken);
  
  document.getElementById('username').textContent = currentUser.username;
  document.getElementById('user-coins').textContent = currentUser.coins;
  document.getElementById('user-avatar').textContent = currentUser.username[0].toUpperCase();
  
  showScreen('lobby');
  loadLeaderboard();
}

function showError(message) {
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = message;
  errorEl.classList.add('show');
  setTimeout(() => errorEl.classList.remove('show'), 3000);
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('gameToken');
  currentUser = null;
  authToken = null;
  showScreen('auth');
});

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    
    const container = document.getElementById('leaderboard');
    if (data.length === 0) {
      container.innerHTML = '<p class="empty-msg">No players yet</p>';
      return;
    }
    
    container.innerHTML = data.map((player, index) => `
      <div class="leaderboard-item">
        <div class="rank ${index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}">${index + 1}</div>
        <div class="avatar">${player.username[0].toUpperCase()}</div>
        <div style="flex: 1;">${player.username}</div>
        <div><strong>${player.wins}</strong> wins</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load leaderboard:', err);
  }
}

document.querySelectorAll('.quick-match').forEach(btn => {
  btn.addEventListener('click', () => {
    const gameType = btn.dataset.game;
    const theme = gameType === 'ludo' ? selectedTheme : 'classic';
    socket.emit('quick_match', gameType, theme);
  });
});

document.getElementById('start-game-btn').addEventListener('click', () => {
  socket.emit('start_game');
});

document.getElementById('leave-room-btn').addEventListener('click', () => {
  socket.emit('leave_game');
  showScreen('lobby');
});

document.getElementById('exit-game-btn').addEventListener('click', () => {
  socket.emit('leave_game');
  showScreen('lobby');
});

document.getElementById('roll-dice-btn').addEventListener('click', () => {
  const dice = document.getElementById('dice-3d');
  if (dice) {
    dice.classList.add('rolling');
  }
  socket.emit('roll_dice');
});

document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (message) {
    socket.emit('send_message', message);
    input.value = '';
  }
}

socket.on('authenticated', (user) => {
  console.log('Socket authenticated:', user);
});

socket.on('auth_error', (error) => {
  console.error('Auth error:', error);
  localStorage.removeItem('gameToken');
  showScreen('auth');
});

socket.on('game_created', (gameState) => {
  currentGame = gameState;
  updateWaitingRoom(gameState);
  showScreen('waiting');
});

socket.on('game_state', (gameState) => {
  currentGame = gameState;
  if (gameState.status === 'waiting') {
    updateWaitingRoom(gameState);
    showScreen('waiting');
  } else if (gameState.status === 'playing') {
    showGameContainer(gameState.type);
    updateGameBoard(gameState);
    showScreen('game');
  }
});

socket.on('uno_hand', (hand) => {
  updateUnoHand(hand);
});

socket.on('monopoly_moved', (data) => {
  currentGame = data.gameState;
  updateMonopolyBoard(data.gameState);
  
  const dice1 = document.getElementById('monopoly-dice-1');
  const dice2 = document.getElementById('monopoly-dice-2');
  if (dice1) {
    dice1.classList.remove('rolling');
    setDiceRotation(dice1, data.diceValue[0]);
  }
  if (dice2) {
    dice2.classList.remove('rolling');
    setDiceRotation(dice2, data.diceValue[1]);
  }
  
  if (data.result && data.result.action) {
    showMonopolyAction(data.result.action);
  }
});

socket.on('monopoly_bought', (data) => {
  currentGame = data.gameState;
  updateMonopolyBoard(data.gameState);
  const buyBtn = document.getElementById('monopoly-buy-btn');
  const passBtn = document.getElementById('monopoly-pass-btn');
  if (buyBtn) buyBtn.style.display = 'none';
  if (passBtn) passBtn.style.display = 'none';
  if (data.property && data.buyerId === currentUser?.id) {
    showDeedPopup(data.property);
  }
});

socket.on('uno_card_played', (data) => {
  currentGame = data.gameState;
  updateUnoTable(data.gameState);
});

socket.on('uno_player_drew', (data) => {
  currentGame = data.gameState;
  updateUnoTable(data.gameState);
});

socket.on('uno_called', (data) => {
  currentGame = data.gameState;
  const player = data.gameState.players[data.playerIndex];
  alert(`${player.username} called UNO!`);
});

socket.on('game_started', (gameState) => {
  currentGame = gameState;
  showScreen('game');
  showGameContainer(gameState.type);
  updateGameBoard(gameState);
});

function showGameContainer(gameType) {
  if (gameType === 'ludo') {
    initLudoBoard();
  }
  document.getElementById('ludo-game').style.display = 'none';
  document.getElementById('monopoly-game').style.display = 'none';
  document.getElementById('uno-game').style.display = 'none';
  
  if (gameType === 'ludo') {
    document.getElementById('ludo-game').style.display = 'flex';
    document.getElementById('game-title').textContent = 'Ludo King';
  } else if (gameType === 'monopoly') {
    document.getElementById('monopoly-game').style.display = 'flex';
    document.getElementById('game-title').textContent = 'Monopoly';
  } else if (gameType === 'uno') {
    document.getElementById('uno-game').style.display = 'flex';
    document.getElementById('game-title').textContent = 'UNO';
  }
}

socket.on('dice_rolled', (data) => {
  const dice = document.getElementById('dice-3d');
  if (dice) {
    dice.classList.remove('rolling');
    setDiceRotation(dice, data.diceValue);
  }
  
  currentGame = data.gameState;
  updateGameBoard(data.gameState);
  
  const myPlayer = currentGame.players.find(p => p.id === currentUser.id);
  if (myPlayer && currentGame.currentPlayerIndex === currentGame.players.indexOf(myPlayer)) {
    showMoveablePieces(myPlayer, data.diceValue);
  }
});

function setDiceRotation(diceElement, value) {
  const rotations = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateX(-90deg) rotateY(0deg)',
    3: 'rotateY(90deg)',
    4: 'rotateY(-90deg)',
    5: 'rotateX(90deg)',
    6: 'rotateY(180deg)'
  };
  diceElement.style.transform = rotations[value] || 'rotateX(0deg) rotateY(0deg)';
}

socket.on('piece_moved', (data) => {
  currentGame = data.gameState;
  updateGameBoard(data.gameState);
  document.getElementById('piece-selection').style.display = 'none';
  const dice = document.getElementById('dice-3d');
  if (dice) {
    dice.style.transform = 'rotateX(-20deg) rotateY(20deg)';
  }
});

socket.on('invalid_move', () => {
  alert('Invalid move! Try again.');
});

socket.on('player_left', (data) => {
  currentGame = data.gameState;
  if (currentGame.status === 'waiting') {
    updateWaitingRoom(data.gameState);
  } else {
    updateGameBoard(data.gameState);
  }
});

socket.on('game_over', (data) => {
  const modal = document.getElementById('game-over-modal');
  document.getElementById('winner-text').textContent = `Winner: ${data.winner.username}`;
  modal.classList.add('active');
});

socket.on('chat_message', (data) => {
  const container = document.getElementById('chat-messages');
  container.innerHTML += `
    <div class="chat-message">
      <div class="sender">${data.user}</div>
      <div class="text">${data.message}</div>
    </div>
  `;
  container.scrollTop = container.scrollHeight;
});

socket.on('games_updated', (games) => {
  updateActiveGames(games);
});

socket.on('error', (message) => {
  alert(message);
});

function updateWaitingRoom(gameState) {
  document.getElementById('game-type-display').textContent = gameState.type.toUpperCase();
  
  const colors = ['red', 'blue', 'green', 'yellow'];
  const container = document.getElementById('players-list');
  
  let html = '';
  for (let i = 0; i < gameState.maxPlayers; i++) {
    const player = gameState.players[i];
    if (player) {
      html += `
        <div class="player-slot ${colors[i]}">
          <div class="player-avatar">${player.username[0].toUpperCase()}</div>
          <div>${player.username}</div>
          ${i === 0 ? '<small>(Host)</small>' : ''}
        </div>
      `;
    } else {
      html += `
        <div class="player-slot empty">
          <div class="player-avatar" style="background: #ccc;">?</div>
          <div>Waiting...</div>
        </div>
      `;
    }
  }
  container.innerHTML = html;
  
  const startBtn = document.getElementById('start-game-btn');
  const isHost = gameState.players[0]?.id === currentUser?.id;
  startBtn.style.display = isHost && gameState.players.length >= 2 ? 'block' : 'none';
}

function updateGameBoard(gameState) {
  if (gameState.type === 'ludo') {
    updateLudoBoard(gameState);
  } else if (gameState.type === 'monopoly') {
    updateMonopolyBoard(gameState);
  } else if (gameState.type === 'uno') {
    updateUnoTable(gameState);
  }
}

function updateLudoBoard(gameState) {
  const playersContainer = document.getElementById('game-players');
  playersContainer.innerHTML = gameState.players.map((player, index) => `
    <div class="player-status ${index === gameState.currentPlayerIndex ? 'current' : ''}">
      <div class="color-indicator ${player.color}"></div>
      <span>${player.username}</span>
      ${index === gameState.currentPlayerIndex ? '<span>(Playing)</span>' : ''}
    </div>
  `).join('');
  
  const myPlayer = gameState.players.find(p => p.id === currentUser.id);
  const isMyTurn = myPlayer && gameState.currentPlayerIndex === gameState.players.indexOf(myPlayer);
  
  const turnIndicator = document.getElementById('turn-indicator');
  if (isMyTurn) {
    turnIndicator.textContent = 'Your Turn';
    turnIndicator.classList.remove('waiting');
  } else {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    turnIndicator.textContent = `${currentPlayer?.username}'s Turn`;
    turnIndicator.classList.add('waiting');
  }
  
  document.getElementById('roll-dice-btn').disabled = !isMyTurn || gameState.diceValue !== null;
  
  updatePiecesOnBoard(gameState);
}

function initLudoBoard() {
  const board = document.querySelector('.ludo-board-grid');
  if (!board) return;
  
  document.querySelectorAll('.ludo-path-cell').forEach(c => c.remove());
  
  const pathCells = [
    { row: 4, col: 1, pos: 7 },
    { row: 4, col: 2, pos: 6 },
    { row: 4, col: 3, pos: 5 },
    { row: 5, col: 1, pos: 8 },
    { row: 5, col: 2, homeStretch: 'red', homePos: 1 },
    { row: 5, col: 3, homeStretch: 'red', homePos: 2 },
    { row: 6, col: 1, pos: 9, safe: true },
    { row: 6, col: 2, pos: 10 },
    { row: 6, col: 3, pos: 11 },
    
    { row: 1, col: 4, pos: 13 },
    { row: 1, col: 5, pos: 14, safe: true, start: 'blue' },
    { row: 1, col: 6, pos: 15 },
    { row: 2, col: 4, pos: 12 },
    { row: 2, col: 5, homeStretch: 'blue', homePos: 1 },
    { row: 2, col: 6, pos: 16 },
    { row: 3, col: 4, pos: 51 },
    { row: 3, col: 5, homeStretch: 'blue', homePos: 2 },
    { row: 3, col: 6, pos: 17 },
    
    { row: 4, col: 7, pos: 19 },
    { row: 4, col: 8, pos: 20 },
    { row: 4, col: 9, pos: 21 },
    { row: 5, col: 7, homeStretch: 'green', homePos: 2 },
    { row: 5, col: 8, homeStretch: 'green', homePos: 1 },
    { row: 5, col: 9, pos: 22, safe: true },
    { row: 6, col: 7, pos: 25 },
    { row: 6, col: 8, pos: 24 },
    { row: 6, col: 9, pos: 23 },
    
    { row: 7, col: 4, pos: 33 },
    { row: 7, col: 5, homeStretch: 'yellow', homePos: 2 },
    { row: 7, col: 6, pos: 27, safe: true, start: 'green' },
    { row: 8, col: 4, pos: 34 },
    { row: 8, col: 5, homeStretch: 'yellow', homePos: 1 },
    { row: 8, col: 6, pos: 26 },
    { row: 9, col: 4, pos: 35, safe: true },
    { row: 9, col: 5, pos: 36 },
    { row: 9, col: 6, pos: 37 },
    
    { row: 4, col: 4, pos: 4 },
    { row: 4, col: 5, pos: 3 },
    { row: 4, col: 6, pos: 2 },
    { row: 6, col: 4, pos: 38 },
    { row: 6, col: 5, pos: 39 },
    { row: 6, col: 6, pos: 40, safe: true, start: 'yellow' },
    
    { row: 1, col: 7, pos: 18 },
    { row: 2, col: 7, pos: 52 },
    { row: 3, col: 7, homeStretch: 'green', homePos: 3 },
    
    { row: 7, col: 1, pos: 46 },
    { row: 8, col: 1, pos: 47 },
    { row: 9, col: 1, pos: 48, safe: true },
    
    { row: 7, col: 3, homeStretch: 'red', homePos: 3 },
    { row: 8, col: 3, pos: 49 },
    { row: 9, col: 3, pos: 50 },
    
    { row: 7, col: 9, pos: 28 },
    { row: 8, col: 9, pos: 29 },
    { row: 9, col: 9, pos: 30 },
    
    { row: 3, col: 9, pos: 31 },
    { row: 2, col: 9, pos: 32 },
    { row: 1, col: 9, pos: 1, safe: true, start: 'red' },
    
    { row: 9, col: 7, homeStretch: 'yellow', homePos: 3 },
    
    { row: 1, col: 3, pos: 41 },
    { row: 2, col: 3, pos: 42 },
    { row: 3, col: 3, pos: 43 },
    { row: 1, col: 1, pos: 44 },
    { row: 2, col: 1, pos: 45 },
  ];
  
  pathCells.forEach(cell => {
    if (cell.area === 'corner') return;
    
    const div = document.createElement('div');
    div.className = 'ludo-path-cell';
    div.style.gridArea = `${cell.row}/${cell.col}`;
    
    if (cell.pos !== undefined && !cell.homeStretch) {
      div.dataset.pos = cell.pos;
    }
    
    if (cell.homeStretch) {
      div.classList.add(`home-stretch-${cell.homeStretch}`);
      div.dataset.homeStretch = cell.homeStretch;
      div.dataset.homePos = cell.homePos;
    }
    
    if (cell.start) {
      div.classList.add(`start-${cell.start}`);
    }
    
    if (cell.safe || SAFE_POSITIONS.includes(cell.pos)) {
      div.classList.add('safe');
    }
    
    board.appendChild(div);
  });
}

function updatePiecesOnBoard(gameState) {
  document.querySelectorAll('.piece-slot .piece').forEach(p => p.remove());
  document.querySelectorAll('.ludo-path-cell .piece').forEach(p => p.remove());
  document.querySelectorAll('.piece-slot').forEach(slot => slot.classList.remove('moveable'));
  
  gameState.players.forEach(player => {
    player.pieces.forEach((pos, index) => {
      const piece = document.createElement('div');
      piece.className = `piece ${player.color}`;
      piece.dataset.pieceIndex = index;
      piece.textContent = index + 1;
      piece.style.fontSize = '10px';
      piece.style.display = 'flex';
      piece.style.alignItems = 'center';
      piece.style.justifyContent = 'center';
      piece.style.color = player.color === 'yellow' ? '#333' : 'white';
      piece.style.fontWeight = 'bold';
      
      if (pos === -1) {
        const slot = document.querySelector(`.${player.color}-home-area .piece-slot[data-index="${index}"]`);
        if (slot) slot.appendChild(piece);
      } else if (pos >= 0 && pos <= 51) {
        const absolutePos = (START_POSITIONS[player.color] + pos) % 52;
        const finalPos = absolutePos === 0 ? 52 : absolutePos;
        const pathCell = document.querySelector(`.ludo-path-cell[data-pos="${finalPos}"]`);
        if (pathCell) pathCell.appendChild(piece);
      } else if (pos >= 52 && pos <= 57) {
        const homePos = pos - 51;
        const homeCell = document.querySelector(`.ludo-path-cell[data-home-stretch="${player.color}"][data-home-pos="${homePos}"]`);
        if (homeCell) homeCell.appendChild(piece);
      }
    });
  });
}

function showMoveablePieces(player, diceValue) {
  const container = document.getElementById('piece-selection');
  const piecesDiv = container.querySelector('.moveable-pieces');
  piecesDiv.innerHTML = '';
  
  let hasMoveable = false;
  
  player.pieces.forEach((pos, index) => {
    let canMove = false;
    if (pos === -1 && diceValue === 6) canMove = true;
    if (pos >= 0 && pos + diceValue <= 57) canMove = true;
    
    if (canMove) {
      hasMoveable = true;
      const btn = document.createElement('button');
      btn.className = `moveable-piece-btn`;
      btn.style.background = getColorHex(player.color);
      btn.textContent = index + 1;
      btn.addEventListener('click', () => {
        socket.emit('move_piece', index);
        container.style.display = 'none';
      });
      piecesDiv.appendChild(btn);
    }
  });
  
  if (hasMoveable) {
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
    setTimeout(() => {
      socket.emit('move_piece', -1);
    }, 1000);
  }
}

function getColorHex(color) {
  const colors = {
    red: '#E74C3C',
    blue: '#3498DB',
    green: '#27AE60',
    yellow: '#F1C40F'
  };
  return colors[color] || '#888';
}

function updateActiveGames(games) {
  const container = document.getElementById('active-games');
  if (games.length === 0) {
    container.innerHTML = '<p class="empty-msg">No active games. Create one!</p>';
    return;
  }
  
  container.innerHTML = games.map(game => `
    <div class="game-item">
      <div>
        <strong>${game.type.toUpperCase()}</strong>
        <span>by ${game.host}</span>
      </div>
      <div>
        <span>${game.players}/${game.maxPlayers} players</span>
        <button class="btn small primary" onclick="joinGame('${game.id}')">Join</button>
      </div>
    </div>
  `).join('');
}

window.joinGame = function(gameId) {
  socket.emit('join_game', gameId);
};

document.getElementById('play-again-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').classList.remove('active');
  if (currentGame) {
    socket.emit('quick_match', currentGame.type);
  } else {
    socket.emit('quick_match', 'ludo');
  }
});

document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
  document.getElementById('game-over-modal').classList.remove('active');
  showScreen('lobby');
  loadLeaderboard();
});

document.getElementById('monopoly-roll-btn')?.addEventListener('click', () => {
  const dice1 = document.getElementById('monopoly-dice-1');
  const dice2 = document.getElementById('monopoly-dice-2');
  if (dice1) dice1.classList.add('rolling');
  if (dice2) dice2.classList.add('rolling');
  socket.emit('monopoly_roll');
});

document.getElementById('monopoly-buy-btn')?.addEventListener('click', () => {
  if (currentGame && pendingProperty) {
    socket.emit('monopoly_buy', pendingProperty.id);
    pendingProperty = null;
  }
});

document.getElementById('monopoly-pass-btn')?.addEventListener('click', () => {
  pendingProperty = null;
  const buyBtn = document.getElementById('monopoly-buy-btn');
  const passBtn = document.getElementById('monopoly-pass-btn');
  const actionDiv = document.getElementById('monopoly-action');
  if (buyBtn) buyBtn.style.display = 'none';
  if (passBtn) passBtn.style.display = 'none';
  if (actionDiv) actionDiv.innerHTML = '';
});

document.getElementById('uno-draw-btn')?.addEventListener('click', () => {
  socket.emit('uno_draw_card');
});

document.getElementById('uno-call-btn')?.addEventListener('click', () => {
  socket.emit('uno_call_uno');
});

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (pendingCardIndex !== null) {
      socket.emit('uno_play_card', pendingCardIndex, color);
      pendingCardIndex = null;
      document.getElementById('uno-color-picker').style.display = 'none';
    }
  });
});

let pendingProperty = null;
let pendingCardIndex = null;

function updateMonopolyBoard(gameState) {
  renderMonopolySpaces(gameState);
  renderPlayerTokensOnBoard(gameState);
  updatePlayerDeeds(gameState);
  updateDeedsPanel(gameState);
  
  const playersContainer = document.getElementById('monopoly-players');
  if (playersContainer) {
    playersContainer.innerHTML = gameState.players.map((player, index) => `
      <div class="monopoly-player-chip ${index === gameState.currentPlayerIndex ? 'current' : ''} ${player.bankrupt ? 'bankrupt' : ''}">
        <span class="token-icon">${PLAYER_TOKENS[player.token]?.icon || '🎮'}</span>
        <span>${player.username}</span>
        <span class="player-money">$${player.money}</span>
      </div>
    `).join('');
  }

  const myPlayer = gameState.players.find(p => p.id === currentUser?.id);
  const playerInfo = document.getElementById('monopoly-player-info');
  if (myPlayer && playerInfo) {
    playerInfo.innerHTML = `
      <div>Your money: <span class="money">$${myPlayer.money}</span> | Position: ${MONOPOLY_PROPERTIES[myPlayer.position]?.name || myPlayer.position}</div>
    `;
  }

  const isMyTurn = myPlayer && gameState.currentPlayerIndex === gameState.players.findIndex(p => p.id === myPlayer.id);
  const rollBtn = document.getElementById('monopoly-roll-btn');
  if (rollBtn) rollBtn.disabled = !isMyTurn;
  
  const turnIndicator = document.getElementById('turn-indicator');
  if (turnIndicator) {
    if (isMyTurn) {
      turnIndicator.textContent = 'Your Turn';
      turnIndicator.classList.remove('waiting');
    } else {
      const currentPlayer = gameState.players[gameState.currentPlayerIndex];
      turnIndicator.textContent = `${currentPlayer?.username}'s Turn`;
      turnIndicator.classList.add('waiting');
    }
  }
}

function renderMonopolySpaces(gameState) {
  const bottomSide = document.getElementById('monopoly-bottom-side');
  const leftSide = document.getElementById('monopoly-left-side');
  const topSide = document.getElementById('monopoly-top-side');
  const rightSide = document.getElementById('monopoly-right-side');
  
  if (!bottomSide || !leftSide || !topSide || !rightSide) return;
  
  const bottomProps = MONOPOLY_PROPERTIES.slice(1, 10);
  const leftProps = MONOPOLY_PROPERTIES.slice(11, 20);
  const topProps = MONOPOLY_PROPERTIES.slice(21, 30);
  const rightProps = MONOPOLY_PROPERTIES.slice(31, 40);
  
  bottomSide.innerHTML = bottomProps.map(prop => renderPropertySpace(prop, gameState, 'bottom')).join('');
  leftSide.innerHTML = leftProps.map(prop => renderPropertySpace(prop, gameState, 'left')).join('');
  topSide.innerHTML = topProps.reverse().map(prop => renderPropertySpace(prop, gameState, 'top')).join('');
  rightSide.innerHTML = rightProps.map(prop => renderPropertySpace(prop, gameState, 'right')).join('');
}

function renderPropertySpace(prop, gameState, side) {
  const owner = gameState?.properties?.find(p => p.id === prop.id)?.owner;
  const ownerPlayer = owner ? gameState.players.find(p => p.id === owner) : null;
  const ownerColor = ownerPlayer ? getTokenColor(ownerPlayer.token) : '';
  
  let colorBar = '';
  let icon = '';
  let priceText = '';
  
  if (prop.type === 'property') {
    colorBar = `<div class="prop-color-bar" style="background: ${PROPERTY_COLORS[prop.color] || '#888'}"></div>`;
    priceText = `<div class="prop-price">$${prop.price}</div>`;
  } else if (prop.type === 'railroad') {
    icon = '<div class="prop-icon">🚂</div>';
    priceText = `<div class="prop-price">$${prop.price}</div>`;
  } else if (prop.type === 'utility') {
    icon = prop.name.includes('Electric') ? '<div class="prop-icon">💡</div>' : '<div class="prop-icon">💧</div>';
    priceText = `<div class="prop-price">$${prop.price}</div>`;
  } else if (prop.type === 'chance') {
    icon = '<div class="prop-icon chance">❓</div>';
  } else if (prop.type === 'chest') {
    icon = '<div class="prop-icon chest">📦</div>';
  } else if (prop.type === 'tax') {
    icon = '<div class="prop-icon tax">💰</div>';
    priceText = `<div class="prop-price">$${prop.price}</div>`;
  }
  
  const ownerBorder = ownerColor ? `border: 3px solid ${ownerColor};` : '';
  
  return `
    <div class="monopoly-space ${prop.type} side-${side}" data-position="${prop.id}" style="${ownerBorder}">
      ${colorBar}
      <div class="prop-name">${getShortName(prop.name)}</div>
      ${icon}
      ${priceText}
      <div class="space-tokens" id="space-tokens-${prop.id}"></div>
    </div>
  `;
}

function getShortName(name) {
  const shorts = {
    'Mediterranean Ave': 'Mediterr.',
    'Community Chest': 'Comm. Chest',
    'Connecticut Ave': 'Connect.',
    'St. Charles Place': 'St. Charles',
    'Electric Company': 'Electric',
    'Pennsylvania Railroad': 'Penn. RR',
    'St. James Place': 'St. James',
    'Tennessee Ave': 'Tennessee',
    'New York Ave': 'New York',
    'Free Parking': 'Free Park',
    'Kentucky Ave': 'Kentucky',
    'Indiana Ave': 'Indiana',
    'Illinois Ave': 'Illinois',
    'B&O Railroad': 'B&O RR',
    'Atlantic Ave': 'Atlantic',
    'Ventnor Ave': 'Ventnor',
    'Water Works': 'Water',
    'Marvin Gardens': 'Marvin',
    'Go To Jail': 'Go Jail',
    'Pacific Ave': 'Pacific',
    'North Carolina Ave': 'N. Carolina',
    'Pennsylvania Ave': 'Penn. Ave',
    'Short Line': 'Short Line',
    'Park Place': 'Park Place',
    'Luxury Tax': 'Luxury Tax',
    'Reading Railroad': 'Reading RR',
    'Oriental Ave': 'Oriental',
    'Vermont Ave': 'Vermont',
    'Baltic Ave': 'Baltic',
    'Income Tax': 'Inc. Tax',
    'States Ave': 'States',
    'Virginia Ave': 'Virginia'
  };
  return shorts[name] || name;
}

function renderPlayerTokensOnBoard(gameState) {
  if (!gameState?.players) return;
  
  document.querySelectorAll('.space-tokens').forEach(el => el.innerHTML = '');
  
  const corners = { 0: 'corner-go', 10: 'corner-jail', 20: 'corner-parking', 30: 'corner-gotojail' };
  
  Object.values(corners).forEach(cornerId => {
    const corner = document.querySelector(`.${cornerId}`);
    if (corner && !corner.querySelector('.space-tokens')) {
      const tokensDiv = document.createElement('div');
      tokensDiv.className = 'space-tokens';
      tokensDiv.id = `space-tokens-corner-${cornerId}`;
      corner.appendChild(tokensDiv);
    }
  });
  
  gameState.players.forEach(player => {
    if (player.bankrupt) return;
    
    const pos = player.position;
    let tokenContainer;
    
    if (corners[pos]) {
      tokenContainer = document.querySelector(`.${corners[pos]} .space-tokens`);
    } else {
      tokenContainer = document.getElementById(`space-tokens-${pos}`);
    }
    
    if (tokenContainer) {
      const tokenEl = document.createElement('span');
      tokenEl.className = 'board-token';
      tokenEl.textContent = PLAYER_TOKENS[player.token]?.icon || '🎮';
      tokenEl.title = player.username;
      tokenContainer.appendChild(tokenEl);
    }
  });
}

function updatePlayerDeeds(gameState) {
  const myPlayer = gameState?.players?.find(p => p.id === currentUser?.id);
  if (!myPlayer) return;
  
  const deedsContainer = document.getElementById('my-deeds');
  if (!deedsContainer) return;
  
  const myProperties = gameState.properties?.filter(p => p.owner === myPlayer.id) || [];
  
  if (myProperties.length === 0) {
    deedsContainer.innerHTML = '<div class="no-deeds">No properties owned yet</div>';
    return;
  }
  
  deedsContainer.innerHTML = myProperties.map(prop => {
    const propInfo = MONOPOLY_PROPERTIES.find(p => p.id === prop.id);
    if (!propInfo) return '';
    return `
      <div class="deed-card" style="border-top: 8px solid ${PROPERTY_COLORS[propInfo.color] || '#666'}">
        <div class="deed-title">${propInfo.name}</div>
        <div class="deed-price">Price: $${propInfo.price}</div>
        <div class="deed-rent">Rent: $${prop.rent?.[0] || propInfo.price / 10}</div>
      </div>
    `;
  }).join('');
}

function showDeedPopup(property) {
  const propInfo = MONOPOLY_PROPERTIES.find(p => p.id === property.id);
  if (!propInfo) return;
  
  const popup = document.getElementById('deed-popup');
  if (!popup) return;
  
  popup.innerHTML = `
    <div class="deed-popup-content" style="border-color: ${PROPERTY_COLORS[propInfo.color] || '#666'}">
      <div class="deed-popup-header" style="background: ${PROPERTY_COLORS[propInfo.color] || '#666'}">
        <h3>TITLE DEED</h3>
        <h2>${propInfo.name}</h2>
      </div>
      <div class="deed-popup-body">
        <p>RENT: $${property.rent?.[0] || 10}</p>
        <p>With 1 House: $${property.rent?.[1] || 50}</p>
        <p>With 2 Houses: $${property.rent?.[2] || 150}</p>
        <p>With 3 Houses: $${property.rent?.[3] || 450}</p>
        <p>With 4 Houses: $${property.rent?.[4] || 625}</p>
        <p>With HOTEL: $${property.rent?.[5] || 750}</p>
        <hr>
        <p>Mortgage Value: $${propInfo.price / 2}</p>
        <p>Houses cost $50 each</p>
        <p>Hotels, $50 plus 4 houses</p>
      </div>
      <button onclick="closeDeedPopup()" class="btn">Close</button>
    </div>
  `;
  popup.style.display = 'flex';
}

function closeDeedPopup() {
  const popup = document.getElementById('deed-popup');
  if (popup) popup.style.display = 'none';
}

function showCardPopup(cardType, card) {
  const popup = document.getElementById('deed-popup');
  if (!popup) return;
  
  const isChance = cardType === 'chance';
  const bgColor = isChance ? '#FF5722' : '#2196F3';
  const icon = isChance ? '❓' : '📦';
  const title = isChance ? 'CHANCE' : 'COMMUNITY CHEST';
  
  popup.innerHTML = `
    <div class="card-popup-content" style="border-color: ${bgColor}">
      <div class="card-popup-header" style="background: ${bgColor}">
        <span class="card-icon">${icon}</span>
        <h3>${title}</h3>
      </div>
      <div class="card-popup-body">
        <p>${card.text}</p>
        <p class="card-effect">${card.effect > 0 ? '+' : ''}$${card.effect}</p>
      </div>
      <button onclick="closeDeedPopup()" class="btn">OK</button>
    </div>
  `;
  popup.style.display = 'flex';
}

function showMonopolyAction(action) {
  const actionDiv = document.getElementById('monopoly-action');
  if (!actionDiv) return;
  
  if (action.type === 'can_buy') {
    actionDiv.innerHTML = `
      <p><strong>${action.property.name}</strong></p>
      <p>Price: $${action.property.price}</p>
      <p>Would you like to buy this property?</p>
    `;
    pendingProperty = action.property;
    const buyBtn = document.getElementById('monopoly-buy-btn');
    const passBtn = document.getElementById('monopoly-pass-btn');
    if (buyBtn) buyBtn.style.display = 'inline-block';
    if (passBtn) passBtn.style.display = 'inline-block';
  } else if (action.type === 'paid_rent') {
    actionDiv.innerHTML = `<p>Paid $${action.rent} rent for ${action.property.name}</p>`;
  } else if (action.type === 'paid_tax') {
    actionDiv.innerHTML = `<p>Paid $${action.amount} in taxes</p>`;
  } else if (action.type === 'went_to_jail') {
    actionDiv.innerHTML = `<p>Go to Jail!</p>`;
  } else if (action.type === 'drew_card') {
    showCardPopup(action.cardType, action.card);
    const effectText = action.card.effect >= 0 ? `+$${action.card.effect}` : `-$${Math.abs(action.card.effect)}`;
    actionDiv.innerHTML = `<p>${action.cardType === 'chance' ? 'Chance' : 'Community Chest'}: ${effectText}</p>`;
  }
}

function getTokenColor(token) {
  const colors = {
    car: '#E74C3C',
    hat: '#3498DB',
    dog: '#27AE60',
    ship: '#9B59B6',
    boot: '#F39C12',
    thimble: '#1ABC9C'
  };
  return colors[token] || '#888';
}

function updateUnoTable(gameState) {
  const opponentsContainer = document.getElementById('uno-opponents');
  if (opponentsContainer) {
    opponentsContainer.innerHTML = gameState.players
      .filter(p => p.id !== currentUser?.id)
      .map((player, index) => `
        <div class="uno-opponent ${gameState.currentPlayerIndex === gameState.players.findIndex(p2 => p2.id === player.id) ? 'current' : ''}">
          <div>${player.username}</div>
          <div class="card-count">${player.handCount} cards</div>
          ${player.uno ? '<div style="color: #F1C40F;">UNO!</div>' : ''}
        </div>
      `).join('');
  }

  const discardContainer = document.getElementById('uno-discard');
  if (discardContainer && gameState.topCard) {
    discardContainer.innerHTML = `
      <div class="uno-card ${gameState.topCard.color}">
        ${getCardDisplay(gameState.topCard)}
      </div>
    `;
  }

  const colorIndicator = document.getElementById('uno-current-color');
  if (colorIndicator) {
    colorIndicator.className = `uno-color-ring ${gameState.currentColor}`;
  }

  const deckCount = document.getElementById('deck-count');
  if (deckCount) deckCount.textContent = gameState.deckCount || 0;
  
  const direction = document.getElementById('uno-direction');
  if (direction) {
    direction.textContent = gameState.direction === 1 ? '↻' : '↺';
  }

  const myPlayer = gameState.players.find(p => p.id === currentUser?.id);
  const isMyTurn = myPlayer && gameState.currentPlayerIndex === gameState.players.findIndex(p => p.id === myPlayer.id);
  
  const drawBtn = document.getElementById('uno-draw-btn');
  if (drawBtn) drawBtn.disabled = !isMyTurn;
  
  const turnIndicator = document.getElementById('turn-indicator');
  if (turnIndicator) {
    if (isMyTurn) {
      turnIndicator.textContent = 'Your Turn';
      turnIndicator.classList.remove('waiting');
    } else {
      const currentPlayer = gameState.players[gameState.currentPlayerIndex];
      turnIndicator.textContent = `${currentPlayer?.username}'s Turn`;
      turnIndicator.classList.add('waiting');
    }
  }
}

function updateUnoHand(hand) {
  const handContainer = document.getElementById('uno-hand');
  if (!handContainer) return;
  handContainer.innerHTML = hand.map((card, index) => `
    <div class="uno-card ${card.color}" data-index="${index}" onclick="playUnoCard(${index}, '${card.color}', '${card.value}')">
      ${getCardDisplay(card)}
    </div>
  `).join('');
}

function getCardDisplay(card) {
  const specialCards = {
    'skip': '⊘',
    'reverse': '⇄',
    'draw2': '+2',
    'wild': 'W',
    'wild4': '+4'
  };
  return specialCards[card.value] || card.value;
}

window.playUnoCard = function(index, color, value) {
  if (color === 'wild') {
    pendingCardIndex = index;
    document.getElementById('uno-color-picker').style.display = 'flex';
  } else {
    socket.emit('uno_play_card', index, null);
  }
};

function updateDeedsPanel(gameState) {
  const deedsList = document.getElementById('deeds-list');
  if (!deedsList || !gameState || gameState.type !== 'monopoly') return;
  
  const myPlayer = gameState.players.find(p => p.id === currentUser?.id);
  if (!myPlayer) return;
  
  const myProperties = gameState.properties?.filter(p => p.owner === myPlayer.id) || [];
  
  const colorCodes = {
    brown: '#8B4513', lightblue: '#87CEEB', pink: '#FF69B4', orange: '#FFA500',
    red: '#FF0000', yellow: '#FFD700', green: '#228B22', darkblue: '#00008B'
  };
  
  deedsList.innerHTML = myProperties.length === 0 
    ? '<p style="color: #888; font-size: 0.8rem;">No properties owned yet</p>'
    : myProperties.map(prop => {
        const propData = MONOPOLY_PROPERTIES.find(p => p.id === prop.id);
        if (!propData || propData.type !== 'property') return '';
        
        const houses = prop.houses || 0;
        const hasHotel = houses === 5;
        const houseCost = propData.price / 2;
        const canBuyHouse = myPlayer.money >= houseCost && houses < 5;
        
        return `
          <div class="deed-card-mini">
            <div class="deed-color-bar" style="background: ${colorCodes[propData.color] || '#ccc'}"></div>
            <div class="deed-name">${propData.name}</div>
            <div class="deed-info">Rent: $${propData.price / 10 * (houses + 1)}</div>
            <div class="building-section">
              <div class="building-icons">
                ${hasHotel ? '<span class="building-icon">🏨</span>' : 
                  Array(houses).fill('<span class="building-icon">🏠</span>').join('')}
              </div>
              <button class="buy-building-btn" 
                ${!canBuyHouse ? 'disabled' : ''} 
                onclick="buyBuilding(${prop.id})">
                ${hasHotel ? 'Max' : houses === 4 ? '🏨 $' + houseCost : '🏠 $' + houseCost}
              </button>
            </div>
          </div>
        `;
      }).join('');
}

window.buyBuilding = function(propertyId) {
  socket.emit('monopoly_buy_building', propertyId);
};

function updateSpectatorList(spectators) {
  const spectatorList = document.getElementById('spectator-list');
  if (!spectatorList) return;
  
  spectatorList.innerHTML = spectators.map(s => 
    `<div class="spectator-badge">${s.username}</div>`
  ).join('');
  
  const spectatorCount = document.getElementById('spectator-count');
  if (spectatorCount) spectatorCount.textContent = `${spectators.length} Watching`;
}

function updatePlayerCount(count) {
  const playerCount = document.getElementById('player-count');
  if (playerCount) playerCount.textContent = `${count} Players`;
}

function sendSticker(sticker) {
  socket.emit('send_sticker', sticker);
}

function showFloatingSticker(sticker, username) {
  const floater = document.createElement('div');
  floater.className = 'sticker-float';
  floater.textContent = sticker;
  floater.style.left = Math.random() * 60 + 20 + '%';
  floater.style.bottom = '100px';
  document.body.appendChild(floater);
  
  setTimeout(() => floater.remove(), 2000);
  
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    const msg = document.createElement('div');
    msg.className = 'chat-message sticker';
    msg.innerHTML = `<strong>${username}:</strong> ${sticker}`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

document.querySelectorAll('.sticker-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sticker = btn.dataset.sticker;
    sendSticker(sticker);
  });
});

socket.on('sticker_received', (data) => {
  showFloatingSticker(data.sticker, data.username);
});

socket.on('spectators_updated', (spectators) => {
  updateSpectatorList(spectators);
});

socket.on('voice_participants_updated', (participants) => {
  const container = document.getElementById('voice-participants');
  if (container) {
    container.innerHTML = participants.map(p => 
      `<div class="voice-participant ${p.speaking ? 'speaking' : ''}">${p.username}</div>`
    ).join('');
  }
});

const voiceToggleBtn = document.getElementById('voice-toggle-btn');
if (voiceToggleBtn) {
  voiceToggleBtn.addEventListener('click', () => {
    if (voiceConnected) {
      socket.emit('leave_voice');
      voiceToggleBtn.textContent = '🎤 Join Voice';
      voiceToggleBtn.classList.remove('active');
    } else {
      socket.emit('join_voice');
      voiceToggleBtn.textContent = '🎤 Leave Voice';
      voiceToggleBtn.classList.add('active');
    }
    voiceConnected = !voiceConnected;
  });
}

socket.on('spectator_joined', (data) => {
  isSpectator = true;
  currentGame = data.gameState;
  showScreen('game');
  showGameContainer(data.gameState.type);
  updateGameBoard(data.gameState);
  document.querySelectorAll('.game-controls button').forEach(btn => btn.disabled = true);
});

socket.on('monopoly_building_bought', (data) => {
  currentGame = data.gameState;
  updateMonopolyBoard(data.gameState);
});

socket.on('room_status_updated', (data) => {
  updatePlayerCount(data.players);
  const spectatorCount = document.getElementById('spectator-count');
  if (spectatorCount) spectatorCount.textContent = `${data.spectators} Watching`;
});

if (authToken) {
  socket.emit('authenticate', authToken);
  fetch('/api/auth/verify', {
    headers: { 'Authorization': `Bearer ${authToken}` }
  }).then(res => {
    if (res.ok) {
      return res.json();
    } else {
      throw new Error('Invalid token');
    }
  }).then(data => {
    handleAuthSuccess({ user: data, token: authToken });
  }).catch(() => {
    localStorage.removeItem('gameToken');
    showScreen('auth');
  });
} else {
  showScreen('auth');
}
