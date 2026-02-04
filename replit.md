# GameHub - Multi-Game Mobile App

## Overview
GameHub is a real-time multiplayer gaming platform that combines three classic games: Ludo, Monopoly, and UNO. This web-based demo showcases the multiplayer functionality with custom themes and social features.

## Current State
- **Backend**: Node.js + Express + Socket.io server running on port 5000
- **Database**: PostgreSQL with user accounts, game sessions, and leaderboards
- **Frontend**: Web-based demo with responsive UI
- **Games**: Ludo (complete), Monopoly (complete), UNO (complete)

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
│   ├── styles.css    # All styling with theme support
│   └── app.js        # Frontend JavaScript
├── package.json      # Dependencies
└── replit.md         # This file
```

## Games Implemented

### 1. Ludo King
- 2-4 players support
- Dice rolling with animation
- Piece movement and capture mechanics
- Turn-based gameplay with validation
- **Custom Themes**: Classic, Candy, Pirate, Christmas

### 2. Monopoly
- 2-6 players support
- Full board with 40 properties displayed with names and prices
- Property color bars for each property group (brown, lightblue, pink, orange, red, yellow, green, darkblue)
- Player tokens on board: 🚗 Car, 🎩 Top Hat, 🐕 Dog, 🚢 Ship, 👢 Boot, 🛡️ Thimble
- Property deed cards displayed when buying properties
- Chance and Community Chest cards with money effects
- Property buying and rent collection
- Dice rolling with 3D animation and player movement
- Bankruptcy and win conditions
- Tax and special spaces

### 3. UNO
- 2-10 players support
- Full deck with all card types
- Special cards: Skip, Reverse, Draw 2, Wild, Wild Draw 4
- Color selection for wild cards
- UNO call functionality
- Turn direction and card drawing

## Features
1. **User Authentication**: Register, login, logout with JWT tokens
2. **Real-time Multiplayer**: Socket.io WebSocket connections
3. **Game Lobby**: View active games, create/join games
4. **Quick Match**: Auto-join or create games
5. **Custom Themes**: 4 visual themes for Ludo
6. **In-Game Chat**: Text messaging during games
7. **Leaderboard**: Global player rankings
8. **Game History**: Saved to database

## API Endpoints
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/verify` - Verify token
- `GET /api/leaderboard` - Get rankings
- `GET /api/games/active` - List joinable games

## WebSocket Events

### General
- `authenticate` - Verify user token
- `create_game` / `join_game` / `quick_match` - Game management
- `start_game` - Host starts game
- `send_message` - In-game chat
- `leave_game` - Exit game

### Ludo
- `roll_dice` - Roll the dice
- `move_piece` - Move a piece

### Monopoly
- `monopoly_roll` - Roll dice and move
- `monopoly_buy` - Buy a property

### UNO
- `uno_play_card` - Play a card
- `uno_draw_card` - Draw from deck
- `uno_call_uno` - Call UNO

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `SESSION_SECRET` - JWT secret key

## Theme Support
The app supports 4 visual themes:
- **Classic**: Purple gradient (default)
- **Candy**: Pink pastel colors
- **Pirate**: Dark ocean blues
- **Christmas**: Red and green festive

## Spectator & Social Features
- **Spectator Mode**: Join games as a viewer without playing
- **Sticker Reactions**: Send animated stickers (clap, fire, heart, etc.) to cheer players
- **Voice Chat**: Join voice channel to talk with players (UI ready, WebRTC implementation pending)
- **Room Status**: Shows player count and spectator count
- **Chat Panel**: Enhanced chat with spectator list and sticker bar

## Monopoly House/Hotel System
- **Deed Panel**: Properties you own displayed beside the board
- **Building Purchase**: Buy houses (up to 4) and hotels on owned properties
- **Visual Indicators**: Building icons shown on deed cards

## Next Steps
1. Implement WebRTC voice chat backend
2. Add friend system
3. Add in-app purchases for themes
4. Multi-language support
5. Mobile app with React Native + Expo
