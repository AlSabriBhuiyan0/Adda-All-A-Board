# GameHub - Multi-Game Mobile App

## Overview
GameHub is a real-time multiplayer gaming platform that combines classic games (Ludo, Monopoly, UNO) with social features. This is the web-based demo version that showcases the multiplayer functionality.

## Current State
- **Backend**: Node.js + Express + Socket.io server running on port 5000
- **Database**: PostgreSQL with user accounts, game sessions, and leaderboards
- **Frontend**: Web-based demo with responsive UI
- **Games**: Ludo (fully implemented), Monopoly and UNO (coming soon)

## Tech Stack
- **Backend**: Node.js, Express, Socket.io, PostgreSQL
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Auth**: JWT-based authentication with bcrypt password hashing

## Project Structure
```
/
├── server/
│   └── index.js      # Main server with API, WebSocket, and game logic
├── public/
│   ├── index.html    # Main HTML file
│   ├── styles.css    # All styling
│   └── app.js        # Frontend JavaScript
├── package.json      # Dependencies
└── replit.md         # This file
```

## Features Implemented
1. **User Authentication**: Register, login, logout with JWT tokens
2. **Real-time Multiplayer**: Socket.io WebSocket connections
3. **Game Lobby**: View active games, create/join games
4. **Quick Match**: Auto-join or create games
5. **Ludo Game**: 
   - 2-4 players support
   - Dice rolling with animation
   - Piece movement and capture mechanics
   - Turn-based gameplay with validation
6. **Chat**: In-game messaging
7. **Leaderboard**: Global player rankings

## API Endpoints
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verify token
- `GET /api/leaderboard` - Get rankings
- `GET /api/games/active` - List joinable games

## WebSocket Events
- `authenticate` - Verify user token
- `create_game` / `join_game` / `quick_match` - Game management
- `start_game` / `roll_dice` / `move_piece` - Gameplay
- `send_message` - Chat

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `SESSION_SECRET` - JWT secret key

## Next Steps
1. Implement Monopoly game logic
2. Implement UNO game logic
3. Add friend system
4. Add custom themes/avatars
5. Mobile app with React Native + Expo
