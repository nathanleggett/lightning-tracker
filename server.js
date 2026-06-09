require('dotenv').config();
const express   = require('express');
const WebSocket = require('ws');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

const MAX_AGE = 24 * 60 * 60 * 1000;
const buffer  = [];

function prune() {
  const cut = Date.now() - MAX_AGE;
  while (buffer.length && buffer[0].time < cut) buffer.shift();
}

const clients = new Set();

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch(e) { clients.delete(res); }
  }
}

const BZ_HOSTS = [
  'ws://ws.blitzortung.org:808',
  'ws://ws.blitzortung.org:8080',
  'ws://ws.blitzortung.org:8082',
  'ws://ws.blitzortung.org:8084',
  'ws://ws.blitzortung.org:8086',
];

let bzWs        = null;
let bzConnected = false;
let bzHostIdx   = 0;
let reconnTimer = null;

function connect() {
  if (bzWs) { try { bzWs.terminate(); } catch(e) {} bzWs = null; }
  const url = BZ_HOSTS[bzHostIdx % BZ_HOSTS.length];
  bzHostIdx++;
  console.log('[BZ] Connecting to', url);
  try {
    bzWs = new WebSocket(url, { handshakeTimeout: 8000 });
  } catch(e) {
    console.warn('[BZ] Socket create failed:', e.message);
    scheduleReconnect();
    return;
  }
  bzWs.on('open', () => {
    bzConnected = true;
    console.log('[BZ] Connected to', url);
    bzWs.send(JSON.stringify({}));
    broadcast({ type: 'status', connected: true });
  });
  bzWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.lat === undefined || msg.lon === undefined) return;
      const strike = {
        id:       `bz-${msg.time}-${Math.random().toString(36).slice(2,6)}`,
        lat:      msg.lat / 1e6,
        lon:      msg.lon / 1e6,
        time:     Math.floor(msg.time / 1e6),
        stations: Array.isArray(msg.sig) ? msg.sig.length : null,
        type:     'CG',
      };
      if (strike.lat < -90 || strike.lat > 90)  return;
      if (strike.lon < -180 || strike.lon > 180) return;
      if (strike.time < Date.now() - MAX_AGE)    return;
      buffer.push(strike);
      prune();
      broadcast(strike);
    } catch(e) {}
  });
  bzWs.on('error', (e) => console.warn('[BZ] Error:', e.message));
  bzWs.on('close', () => {
    bzConnected = false;
    console.log('[BZ] Disconnected — reconnecting…');
    broadcast({ type: 'status', connected: false });
    scheduleReconnect();
  });
}

function scheduleReconnect(ms = 5000) {
  clearTimeout(reconnTimer);
  reconnTimer = setTimeout(connect, ms);
}

setInterval(() => {
  if (bzWs && bzWs.readyState === WebSocket.OPEN) {
    try { bzWs.ping(); } catch(e) {}
  }
}, 30000);

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  prune();
  const history = buffer.filter(s => s.time >= Date.now() - 60 * 60 * 1000);
  if (history.length) {
    res.write(`data: ${JSON.stringify({ type: 'history', strikes: history })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: 'status', connected: bzConnected })}\n\n`);
  clients.add(res);
  console.log(`[SSE] +client (${clients.size} connected)`);
  req.on('close', () => {
    clients.delete(res);
    console.log(`[SSE] -client (${clients.size} connected)`);
  });
});

app.get('/api/status', (_req, res) => {
  prune();
  res.json({ connected: bzConnected, buffered: buffer.length, clients: clients.size });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ StrikeLive on http://0.0.0.0:${PORT}`);
  connect();
});
