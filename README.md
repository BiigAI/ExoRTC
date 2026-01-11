# ExoRTC - P2P Voice Communication Platform

A Discord-like P2P voice communication platform for squad-based gaming with global "shout" capability for squad leaders.

## Features

- 🎙️ **P2P Voice**: Direct peer-to-peer voice communication using WebRTC
- 🏠 **Server/Room System**: Create servers, invite users, and organize rooms (squads)
- 📢 **Shout Feature**: Squad leaders can broadcast to all other squad leaders
- ⌨️ **Global PTT**: Push-to-talk works even when the app is not focused
- 🔐 **User Authentication**: Account system with JWT-based auth

## Project Structure

```
ExoRTC/
├── server/          # Node.js signaling server
│   ├── src/
│   │   ├── config/     # Database configuration
│   │   ├── routes/     # REST API routes
│   │   ├── services/   # Business logic
│   │   ├── middleware/ # Auth middleware
│   │   └── models/     # Database schema
│   └── package.json
│
└── client/          # Electron desktop app
    ├── src/
    │   ├── main/       # Electron main process
    │   ├── renderer/   # UI (HTML/CSS/JS)
    │   └── preload.ts  # IPC bridge
    └── package.json
```

## Quick Start

### 1. Start the Server

```bash
cd server
npm install
npm run dev
```

The server will start on `http://localhost:3000`

### 2. Start the Client (Development)

In a new terminal:

```bash
cd client
npm install
npm run dev
```

This will compile TypeScript and launch the Electron app.

## Usage

### Creating a Server

1. Register or login
2. Click "Create Server" and enter a name
3. Share the invite code with others

### Joining a Server

1. Get an invite code from a server owner
2. Click "Join Server" and enter the code

### Voice Communication

1. Click on a room to join
2. Hold **V** key to talk (Push-to-Talk)
3. If you have shout permission, hold **B** to broadcast to all squad leaders

### Admin Features

Squad leaders/admins can:
- Create rooms within a server
- Grant shout permissions to users

## Configuration

### Server Environment (.env)

```
PORT=3000
JWT_SECRET=your-secret-key
NODE_ENV=development
```

### PTT Hotkeys

- **V** - Push to Talk
- **B** - Shout (broadcast to squad leaders)

## Technology Stack

| Component | Technology |
|-----------|------------|
| Client | Electron + TypeScript |
| Server | Node.js + Express |
| Real-time | Socket.IO |
| Voice | WebRTC |
| Database | SQLite (sql.js) |
| Auth | JWT + bcrypt |
| Global Hotkeys | uiohook-napi |

## Development Notes

### Building for Production

```bash
# Server
cd server
npm run build
npm start

# Client (creates Windows installer)
cd client
npm run dist
```

### Architecture

- **Server**: Handles signaling, authentication, and room state. Does NOT process audio.
- **Client**: P2P mesh network for audio. Each user connects directly to others in the same room.
- **Shout**: Creates temporary P2P connections to all squad leaders for broadcast.

## License

MIT
