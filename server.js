// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 20; // updates per second
const DT = 1 / TICK_RATE;
const PLAYER_SPEED = 220; // px/sec
const BULLET_SPEED = 600; // px/sec
const WORLD = { w: 960, h: 640 };

app.use(express.static('public'));

// Rooms map: roomName -> { players: Map, bullets: Map, pickups: Map, lastPickupSpawn }
const rooms = new Map();

function makeRoomIfMissing(name) {
  if (!rooms.has(name)) {
    rooms.set(name, {
      players: new Map(),
      bullets: new Map(),
      pickups: new Map(),
      lastPickupSpawn: Date.now(),
      createdAt: Date.now()
    });
  }
  return rooms.get(name);
}

function randomColor() {
  return '#' + Math.floor(Math.random()*0xFFFFFF).toString(16).padStart(6,'0');
}

function spawnPickup(room) {
  const id = Math.random().toString(36).slice(2,9);
  const x = 20 + Math.random()*(WORLD.w-40);
  const y = 20 + Math.random()*(WORLD.h-40);
  const kind = Math.random() < 0.6 ? 'score' : 'health';
  room.pickups.set(id, { id, x, y, kind });
}

io.on('connection', (socket) => {
  console.log('connect', socket.id);
  socket.data.rate = { lastInput: 0, lastChat: 0, lastShot: 0 };
  socket.on('join', ({ name, room, color }) => {
    if (!room || !name) return socket.emit('errorMsg', 'missing name or room');
    room = String(room).trim().slice(0,40);
    name = String(name).trim().slice(0,24);
    color = color || randomColor();

    socket.join(room);
    const r = makeRoomIfMissing(room);

    const startX = 40 + Math.random()*(WORLD.w-80);
    const startY = 40 + Math.random()*(WORLD.h-80);
    const player = {
      id: socket.id,
      name,
      color,
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      health: 100,
      score: 0,
      input: { up:false,down:false,left:false,right:false },
      lastShot: 0,
      respawnAt: 0
    };
    r.players.set(socket.id, player);
    socket.data.room = room;

    // notify the new player with room/world info and current state
    socket.emit('joined', { id: socket.id, world: WORLD });

    // notify other players
    socket.to(room).emit('playerJoined', { id: player.id, name: player.name, color: player.color });

    // send a welcome chat
    io.to(room).emit('chat', { id: 'system', name: 'System', text: `${player.name} joined the room.` });
  });

  socket.on('input', (data) => {
    const t = Date.now();
    // simple rate limit: allow input up to TICK_RATE times per second
    if (t - socket.data.rate.lastInput < (1000 / (TICK_RATE * 0.9))) return;
    socket.data.rate.lastInput = t;
    const roomName = socket.data.room;
    if (!roomName) return;
    const room = rooms.get(roomName);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    // sanitize
    p.input = {
      up: !!data.up,
      down: !!data.down,
      left: !!data.left,
      right: !!data.right
    };
  });

  socket.on('shoot', (aim) => {
    const t = Date.now();
    const roomName = socket.data.room;
    if (!roomName) return;
    const room = rooms.get(roomName);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    // rate limit shots (250ms)
    if (t - p.lastShot < 200) return;
    p.lastShot = t;
    // create bullet from player's position
    const angle = typeof aim === 'number' ? aim : 0;
    const bx = p.x + Math.cos(angle) * 16;
    const by = p.y + Math.sin(angle) * 16;
    const id = Math.random().toString(36).slice(2,9);
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;
    room.bullets.set(id, { id, owner: p.id, x: bx, y: by, vx, vy, life: 2.0 });
  });

  socket.on('chat', (text) => {
    const t = Date.now();
    if (t - socket.data.rate.lastChat < 400) return; // simple chat throttle
    socket.data.rate.lastChat = t;
    const roomName = socket.data.room;
    if (!roomName) return;
    const room = rooms.get(roomName);
    if (!room) return;
    const p = room.players.get(socket.id);
    const name = p ? p.name : '??';
    io.to(roomName).emit('chat', { id: socket.id, name, text: String(text).slice(0,200) });
  });

  socket.on('disconnect', () => {
    const roomName = socket.data.room;
    if (roomName) {
      const room = rooms.get(roomName);
      if (room) {
        room.players.delete(socket.id);
        io.to(roomName).emit('playerLeft', { id: socket.id });
        io.to(roomName).emit('chat', { id: 'system', name: 'System', text: `${socket.id} left the room.` });
        // if empty room, delete it after a short time
        if (room.players.size === 0) {
          setTimeout(() => {
            if (room.players.size === 0) rooms.delete(roomName);
          }, 30_000);
        }
      }
    }
    console.log('disconnect', socket.id);
  });
});

// Global tick
setInterval(() => {
  const now = Date.now();
  for (const [roomName, room] of rooms.entries()) {
    // spawn pickups occasionally
    if (now - room.lastPickupSpawn > 7000 && room.pickups.size < 6) {
      spawnPickup(room);
      room.lastPickupSpawn = now;
    }

    // update players
    for (const p of room.players.values()) {
      if (p.respawnAt && now < p.respawnAt) continue; // dead
      let vx = 0, vy = 0;
      if (p.input.left) vx -= 1;
      if (p.input.right) vx += 1;
      if (p.input.up) vy -= 1;
      if (p.input.down) vy += 1;
      const len = Math.hypot(vx, vy) || 1;
      p.vx = (vx / len) * PLAYER_SPEED;
      p.vy = (vy / len) * PLAYER_SPEED;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.x = Math.max(12, Math.min(WORLD.w-12, p.x));
      p.y = Math.max(12, Math.min(WORLD.h-12, p.y));
    }

    // update bullets
    for (const [bid, b] of room.bullets.entries()) {
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      b.life -= DT;
      if (b.x < -10 || b.x > WORLD.w+10 || b.y < -10 || b.y > WORLD.h+10 || b.life <= 0) {
        room.bullets.delete(bid);
        continue;
      }
      // collision with players
      for (const p of room.players.values()) {
        if (p.id === b.owner) continue; // don't hit yourself
        if (p.respawnAt && now < p.respawnAt) continue; // dead
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        if (dx*dx + dy*dy < 16*16) {
          // hit
          p.health -= 34;
          const owner = room.players.get(b.owner);
          if (p.health <= 0) {
            p.health = 0;
            p.respawnAt = now + 2000;
            p.x = -100; p.y = -100; // move offscreen until respawn
            if (owner) owner.score += 1;
            io.to(roomName).emit('chat', { id: 'system', name: 'System', text: `${owner ? owner.name : 'Someone'} eliminated ${p.name}` });
          }
          room.bullets.delete(bid);
          break;
        }
      }
    }

    // pickups collision
    for (const [pid, pick] of room.pickups.entries()) {
      for (const p of room.players.values()) {
        if (p.respawnAt && now < p.respawnAt) continue;
        const dx = p.x - pick.x;
        const dy = p.y - pick.y;
        if (dx*dx + dy*dy < 14*14) {
          if (pick.kind === 'health') {
            p.health = Math.min(100, p.health + 30);
          } else {
            p.score += 1;
          }
          room.pickups.delete(pid);
          io.to(roomName).emit('chat', { id: 'system', name: 'System', text: `${p.name} picked up ${pick.kind}` });
          break;
        }
      }
    }

    // respawn players
    for (const p of room.players.values()) {
      if (p.respawnAt && now >= p.respawnAt) {
        p.x = 40 + Math.random()*(WORLD.w-80);
        p.y = 40 + Math.random()*(WORLD.h-80);
        p.health = 100;
        p.respawnAt = 0;
      }
    }

    // broadcast lightweight snapshot to room
    const playersSnap = Array.from(room.players.values()).map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color, name: p.name, score: p.score, health: p.health, dead: !!p.respawnAt }));
    const bulletsSnap = Array.from(room.bullets.values()).map(b => ({ id: b.id, x: b.x, y: b.y }));
    const pickupsSnap = Array.from(room.pickups.values()).map(pk => ({ id: pk.id, x: pk.x, y: pk.y, kind: pk.kind }));

    io.to(roomName).volatile.emit('roomState', { t: now, players: playersSnap, bullets: bulletsSnap, pickups: pickupsSnap });
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log('Server listening on', PORT));
