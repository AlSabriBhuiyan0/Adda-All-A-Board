const socket = io();

let currentUser = null;
let currentGame = null;
let authToken = localStorage.getItem('gameToken');
let selectedTheme = localStorage.getItem('gameTheme') || 'classic';

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

function updatePiecesOnBoard(gameState) {
  document.querySelectorAll('.piece-slot .piece').forEach(p => p.remove());
  document.querySelectorAll('.piece-slot').forEach(slot => slot.classList.remove('moveable'));
  
  gameState.players.forEach(player => {
    player.pieces.forEach((pos, index) => {
      if (pos === -1) {
        const slot = document.querySelector(`.${player.color}-home .piece-slot[data-index="${index}"]`);
        if (slot) {
          const piece = document.createElement('div');
          piece.className = `piece ${player.color}`;
          piece.dataset.pieceIndex = index;
          slot.appendChild(piece);
        }
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
  const playersContainer = document.getElementById('monopoly-players');
  if (playersContainer) {
    playersContainer.innerHTML = gameState.players.map((player, index) => `
      <div class="monopoly-player-chip ${index === gameState.currentPlayerIndex ? 'current' : ''} ${player.bankrupt ? 'bankrupt' : ''}">
        <div class="player-token" style="background: ${getTokenColor(player.token)}"></div>
        <span>${player.username}</span>
        <span class="player-money">$${player.money}</span>
      </div>
    `).join('');
  }

  const myPlayer = gameState.players.find(p => p.id === currentUser?.id);
  const playerInfo = document.getElementById('monopoly-player-info');
  if (myPlayer && playerInfo) {
    playerInfo.innerHTML = `
      <div>Your money: <span class="money">$${myPlayer.money}</span> | Position: ${myPlayer.position} | Properties: ${myPlayer.properties?.length || 0}</div>
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
