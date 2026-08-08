// public/game.js
const socket = io();

// UI
const lobby = document.getElementById('lobby');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const colorInput = document.getElementById('colorInput');
const joinBtn = document.getElementById('joinBtn');
const lobbyInfo = document.getElementById('lobbyInfo');

const gameUI = document.getElementById('gameUI');
const roomLabel = document.getElementById('roomLabel');
const scoreboard = document.getElementById('scoreboard');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let myId = null;
let roomName = null;
let world = { w: canvas.width, h: canvas.height };
let players = new Map();
let bullets = new Map();
let pickups = new Map();

let keys = {};
let mouse = { x: 0, y: 0, down: false };

joinBtn.addEventListener('click', () => {
  const name = nameInput.value || ('Player'+Math.floor(Math.random()*1000));
  const room = roomInput.value || 'arena';
  const color = colorInput.value || '#ff8800';
  socket.emit('join', { name, room, color });
});

socket.on('joined', (data) => {
  myId = data.id;
  roomName = document.getElementById('roomInput').value || 'arena';
  world = data.world || world;
  lobby.style.display = 'none';
  gameUI.style.display = 'flex';
  roomLabel.textContent = `Room: ${roomName}`;
  addChat('System', 'Joined room: ' + roomName);
});

socket.on('playerJoined', (p) => {
  addChat('System', `${p.name || p.id} joined.`);
});

socket.on('playerLeft', ({ id }) => {
  addChat('System', `${id} left.`);
});

socket.on('chat', (m) => {
  addChat(m.name, m.text);
});

socket.on('errorMsg', (t) => addChat('ERROR', t));

socket.on('roomState', (state) => {
  // apply snapshot
  players.clear();
  for (const p of state.players) players.set(p.id, p);
  bullets.clear();
  for (const b of state.bullets) bullets.set(b.id, b);
  pickups.clear();
  for (const pk of state.pickups) pickups.set(pk.id, pk);
  // update scoreboard
  renderScoreboard();
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat', text);
  chatInput.value = '';
});

function addChat(name, text) {
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = `<strong>${escapeHtml(name)}:</strong> ${escapeHtml(text)}`;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s) { return String(s).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function renderScoreboard() {
  const arr = Array.from(players.values()).sort((a,b) => b.score - a.score);
  scoreboard.innerHTML = '';
  for (const p of arr) {
    const el = document.createElement('div');
    el.textContent = `${p.name} ${p.id===myId? '(you)':''} — ${p.score} — ${p.health||0}hp`;
    el.style.color = p.color || '#fff';
    scoreboard.appendChild(el);
  }
}

// input handling
window.addEventListener('keydown', (e)=>{ keys[e.key] = true; updateInput(); });
window.addEventListener('keyup', (e)=>{ keys[e.key] = false; updateInput(); });
canvas.addEventListener('mousemove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left);
  mouse.y = (e.clientY - rect.top);
});
canvas.addEventListener('mousedown', (e)=>{ mouse.down = true; shoot(); });
canvas.addEventListener('mouseup', (e)=>{ mouse.down = false; });

function updateInput() {
  const input = {
    up: keys['w']||keys['ArrowUp'],
    down: keys['s']||keys['ArrowDown'],
    left: keys['a']||keys['ArrowLeft'],
    right: keys['d']||keys['ArrowRight']
  };
  socket.emit('input', input);
}

function shoot() {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;
  const dx = mouse.x - me.x;
  const dy = mouse.y - me.y;
  const angle = Math.atan2(dy, dx);
  socket.emit('shoot', angle);
}

// auto-fire while mouse held (client-side convenience, server will rate-limit)
setInterval(()=>{ if (mouse.down) shoot(); }, 120);

// draw loop
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background
  ctx.fillStyle = '#032528';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // pickups
  for (const pk of pickups.values()) {
    if (pk.kind === 'health') {
      ctx.fillStyle = '#ff5c5c';
    } else {
      ctx.fillStyle = '#ffd14d';
    }
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 8, 0, Math.PI*2); ctx.fill();
  }

  // bullets
  ctx.fillStyle = '#fff';
  for (const b of bullets.values()) {
    ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
  }

  // players
  for (const p of players.values()) {
    ctx.beginPath(); ctx.fillStyle = p.color || '#fff';
    ctx.arc(p.x, p.y, 12, 0, Math.PI*2); ctx.fill();
    // name
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText(p.name, p.x-18, p.y-18);
    // health bar
    ctx.fillStyle = '#333'; ctx.fillRect(p.x-16, p.y+14, 32, 6);
    ctx.fillStyle = '#4caf50'; ctx.fillRect(p.x-16, p.y+14, (p.health||0)/100 * 32, 6);
    if (p.id === myId) {
      ctx.strokeStyle = '#fff'; ctx.strokeRect(p.x-18, p.y-18, 36, 36);
    }
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// helper
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }

