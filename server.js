const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.db');
const DEFAULT_TICK_MS = Number(process.env.TICK_MS) || 1000; // 1s default
const START_MONEY = Number(process.env.START_MONEY) || 1000;

// Init DB
const db = new sqlite3.Database(DB_FILE);
function runAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function initDb() {
  await runAsync(`CREATE TABLE IF NOT EXISTS substances (
    id TEXT PRIMARY KEY,
    name TEXT,
    min_price REAL,
    max_price REAL,
    base_price REAL
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    settings_json TEXT
  )`);

  await runAsync(`CREATE TABLE IF NOT EXISTS highscores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_name TEXT,
    cash REAL,
    timestamp INTEGER
  )`);

  // Seed substances if not present
  const count = await getAsync('SELECT COUNT(*) as c FROM substances');
  if (count && count.c === 0) {
    const subs = [
      { id: 'kokain', name: 'Kokainhydrochlorid', min: 15, max: 120, base: 50 },
      { id: 'diamorphin', name: 'Diacethylmorphin', min: 15, max: 90, base: 40 },
      { id: 'dmt', name: 'Dimethyltryptamin', min: 10, max: 200, base: 80 }
    ];
    const stmt = db.prepare('INSERT INTO substances (id,name,min_price,max_price,base_price) VALUES (?,?,?,?,?)');
    subs.forEach(s => stmt.run(s.id, s.name, s.min, s.max, s.base));
    stmt.finalize();
    console.log('Seeded substances');
  }
}

// In-memory room states (drugs, players, intervals)
const rooms = {}; // roomId -> { players: {socketId: player}, drugs: {id:{...}}, settings: {...}, tickMs, interval }

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function rndBetween(min,max){return Math.random()*(max-min)+min}

async function ensureRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];
  // Load substances from DB
  const subs = await allAsync('SELECT * FROM substances');
  const drugs = {};
  subs.forEach(s => {
    drugs[s.id] = { id: s.id, name: s.name, min: s.min_price, max: s.max_price, price: s.base_price };
  });
  // Load settings if saved
  let settings = { tickMs: DEFAULT_TICK_MS, startMoney: START_MONEY, winByMoney: true, moneyTarget: 100000, timeTargetSec: 3600 };
  const row = await getAsync('SELECT settings_json FROM rooms WHERE id = ?', [roomId]);
  if (row && row.settings_json) {
    try { settings = Object.assign(settings, JSON.parse(row.settings_json)); } catch(e){}
  }

  const room = { players: {}, drugs, settings, interval: null, _startedAt: Date.now() };
  rooms[roomId] = room;
  startRoomTicker(roomId);
  return room;
}

function startRoomTicker(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.interval) clearInterval(room.interval);
  const tickMs = room.settings.tickMs || DEFAULT_TICK_MS;
  room.interval = setInterval(async () => {
    // Update prices random walk
    Object.values(room.drugs).forEach(d => {
      const range = d.max - d.min;
      const volatility = Math.max(1, range * 0.12);
      let change = (Math.random() - 0.5) * volatility;
      let newPrice = Math.round((d.price + change) * 100) / 100;
      newPrice = clamp(newPrice, d.min, d.max);
      d.price = newPrice;
    });
    // Broadcast market update to room
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
    // Check win conditions
    await checkWinConditions(roomId);
  }, tickMs);
}

function stopRoomTicker(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.interval) { clearInterval(room.interval); room.interval = null; }
}

function publicRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return {};
  return {
    drugs: Object.values(room.drugs).map(d => ({ id: d.id, name: d.name, price: d.price, min: d.min, max: d.max })),
    players: Object.values(room.players).map(p => ({ name: p.name, cash: p.cash }))
  };
}

function broadcastRoom(roomId, ev, data) {
  const room = rooms[roomId];
  if (!room) return;
  Object.keys(room.players).forEach(sid => {
    io.to(sid).emit(ev, data);
  });
}

async function saveRoomSettings(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const json = JSON.stringify(room.settings);
  await runAsync('INSERT OR REPLACE INTO rooms (id, settings_json) VALUES (?,?)', [roomId, json]);
}

async function checkWinConditions(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const settings = room.settings;
  // Win by money
  if (settings.winByMoney) {
    const target = Number(settings.moneyTarget) || 1e12;
    for (const p of Object.values(room.players)) {
      if (p.cash >= target) {
        // announce winner
        broadcastRoom(roomId, 'gameOver', { winner: p.name, reason: 'money', cash: p.cash });
        await runAsync('INSERT INTO highscores (player_name,cash,timestamp) VALUES (?,?,?)', [p.name, p.cash, Date.now()]);
        // reset room (stop ticker)
        stopRoomTicker(roomId);
        return;
      }
    }
  } else {
    // Win by time: after timeTargetSec seconds have passed since room start
    if (!room._startedAt) room._startedAt = Date.now();
    const elapsedSec = (Date.now() - room._startedAt)/1000;
    if (elapsedSec >= Number(settings.timeTargetSec)) {
      // highest cash wins
      let winner = null;
      Object.values(room.players).forEach(p => {
        if (!winner || p.cash > winner.cash) winner = p;
      });
      if (winner) {
        broadcastRoom(roomId, 'gameOver', { winner: winner.name, reason: 'time', cash: winner.cash });
        await runAsync('INSERT INTO highscores (player_name,cash,timestamp) VALUES (?,?,?)', [winner.name, winner.cash, Date.now()]);
        stopRoomTicker(roomId);
      }
    }
  }
}

// Express + Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/substances', async (req,res) => {
  const subs = await allAsync('SELECT * FROM substances');
  res.json(subs);
});

app.get('/api/highscores', async (req,res) => {
  const rows = await allAsync('SELECT player_name,cash,timestamp FROM highscores ORDER BY cash DESC LIMIT 50');
  res.json(rows);
});

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join', async ({ name, room }) => {
    const roomId = (room || 'main').toString();
    const cleanName = (name || 'Spieler').substring(0,30);
    const roomObj = await ensureRoom(roomId);
    // create player
    const player = { id: socket.id, name: cleanName, cash: roomObj.settings.startMoney || START_MONEY, inventory: {}, lastSeen: Date.now() };
    // ensure inventory init
    Object.keys(roomObj.drugs).forEach(did => player.inventory[did] = 0);
    roomObj.players[socket.id] = player;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('joined', { id: socket.id, yourState: player, public: publicRoomState(roomId), settings: roomObj.settings });
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
  });

  socket.on('buy', ({ drugId, qty }) => {
    const roomId = socket.roomId || 'main';
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return socket.emit('actionResult', { ok:false, message:'Nicht verbunden.' });
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return socket.emit('actionResult', { ok:false, message:'Ungültige Menge.' });
    const drug = room.drugs[drugId];
    if (!drug) return socket.emit('actionResult', { ok:false, message:'Unbekannte Ware.' });
    const cost = +(drug.price * qty).toFixed(2);
    if (p.cash < cost) return socket.emit('actionResult', { ok:false, message:'Nicht genug Geld.' });
    p.cash = +(p.cash - cost).toFixed(2);
    p.inventory[drugId] = (p.inventory[drugId]||0) + qty;
    socket.emit('actionResult', { ok:true, message:`Gekauft: ${qty} x ${drug.name} für ${cost}€`, yourState: p });
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
  });

  socket.on('sell', ({ drugId, qty }) => {
    const roomId = socket.roomId || 'main';
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return socket.emit('actionResult', { ok:false, message:'Nicht verbunden.' });
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return socket.emit('actionResult', { ok:false, message:'Ungültige Menge.' });
    const drug = room.drugs[drugId];
    if (!drug) return socket.emit('actionResult', { ok:false, message:'Unbekannte Ware.' });
    const have = p.inventory[drugId] || 0;
    if (have < qty) return socket.emit('actionResult', { ok:false, message:'Nicht genug Inventar.' });
    const revenue = +(drug.price * qty).toFixed(2);
    p.inventory[drugId] -= qty;
    p.cash = +(p.cash + revenue).toFixed(2);
    socket.emit('actionResult', { ok:true, message:`Verkauft: ${qty} x ${drug.name} für ${revenue}€`, yourState: p });
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
  });

  socket.on('requestState', async () => {
    const roomId = socket.roomId || 'main';
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (!p) return;
    socket.emit('state', { yourState: p, public: publicRoomState(roomId), settings: room.settings });
  });

  socket.on('updateSettings', async (newSettings) => {
    const roomId = socket.roomId || 'main';
    const room = rooms[roomId];
    if (!room) return;
    // merge and validate
    room.settings = Object.assign(room.settings || {}, {
      tickMs: Number(newSettings.tickMs) || room.settings.tickMs,
      startMoney: Number(newSettings.startMoney) || room.settings.startMoney,
      winByMoney: Boolean(newSettings.winByMoney),
      moneyTarget: Number(newSettings.moneyTarget) || room.settings.moneyTarget,
      timeTargetSec: Number(newSettings.timeTargetSec) || room.settings.timeTargetSec
    });
    await saveRoomSettings(roomId);
    startRoomTicker(roomId);
    broadcastRoom(roomId, 'settingsUpdated', room.settings);
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    delete room.players[socket.id];
    broadcastRoom(roomId, 'marketUpdate', publicRoomState(roomId));
  });
});

(async () => {
  await initDb();
  server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
