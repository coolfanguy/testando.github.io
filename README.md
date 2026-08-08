# Testando Multiplayer (socket.io)

This branch adds a simple multiplayer backend (Node + Express + socket.io) and a client UI with:
- Rooms/lobbies (join by room name)
- Display name & color
- Chat (per-room)
- Server-authoritative simulation: player movement, bullets, pickups, scoring
- Simple rate-limits and anti-spam measures

How to run locally

1. Install dependencies

   npm install

2. Start server

   npm start

3. Open http://localhost:3000 in multiple browser tabs to test.

Notes

- GitHub Pages cannot host the Node server. Deploy the server to a host that supports WebSockets (Render, Railway, Heroku, Fly, or a VPS).
- The client is served from the same server under `/`.

Next improvements
- Persistent accounts / leaderboard (DB)
- Matchmaking / public room list
- Better interpolation / client-side prediction
- Anti-cheat verification and move validation tuned for your gameplay

