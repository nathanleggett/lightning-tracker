/**
 * Lightning Tracker — Proxy Server
 * 
 * Keeps API keys server-side, normalises responses from multiple
 * lightning data providers into a single consistent format, and
 * serves the static frontend.
 */

require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const PROVIDER = (process.env.LIGHTNING_PROVIDER || 'demo').toLowerCase();

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(__dirname));


// ── Normalised strike schema ──────────────────────────────────────────────────
// {
//   id:        string   — unique identifier
//   lat:       number   — latitude
//   lon:       number   — longitude
//   time:      number   — unix timestamp ms
//   type:      string   — 'CG' | 'IC' | 'CC' | 'unknown'
//   amplitude: number|null  — kA (cloud-to-ground polarity & strength)
//   error:     number|null  — location error radius in km
//   stations:  number|null  — number of detection stations
// }

// ── Demo / simulation mode ────────────────────────────────────────────────────
// Generates a realistic storm cell that drifts over time so you can develop
// and demo the UI without a paid API key.

const DEMO_STORM = {
  lat: 51.5,
  lon: -0.12,
  radius: 1.2,   // degrees
  heading: 45,   // degrees, drifts NE
  strikeCache: [],
  lastUpdate: 0,
};

function demoStrikes(boundingBox) {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;

  // Drift the storm cell
  const drift = (now - DEMO_STORM.lastUpdate) / 1000 / 3600;
  DEMO_STORM.lat += Math.sin((DEMO_STORM.heading * Math.PI) / 180) * drift * 0.05;
  DEMO_STORM.lon += Math.cos((DEMO_STORM.heading * Math.PI) / 180) * drift * 0.05;
  DEMO_STORM.lastUpdate = now;

  // Prune old cached strikes
  DEMO_STORM.strikeCache = DEMO_STORM.strikeCache.filter(s => now - s.time < maxAge);

  // Add 3–12 new strikes per call (simulating real polling cadence)
  const newCount = Math.floor(Math.random() * 10) + 3;
  for (let i = 0; i < newCount; i++) {
    const angle  = Math.random() * 2 * Math.PI;
    const dist   = Math.random() * DEMO_STORM.radius;
    const types  = ['CG', 'CG', 'CG', 'IC', 'CC'];
    const strike = {
      id:        `demo-${now}-${Math.random().toString(36).slice(2)}`,
      lat:       DEMO_STORM.lat + Math.sin(angle) * dist,
      lon:       DEMO_STORM.lon + Math.cos(angle) * dist,
      time:      now - Math.floor(Math.random() * 60000),
      type:      types[Math.floor(Math.random() * types.length)],
      amplitude: Math.random() > 0.3 ? (Math.random() * 120 - 20).toFixed(1) * 1 : null,
      error:     (Math.random() * 3 + 0.5).toFixed(2) * 1,
      stations:  Math.floor(Math.random() * 15) + 3,
    };
    DEMO_STORM.strikeCache.push(strike);
  }

  // Filter to bounding box if provided
  if (boundingBox) {
    const { north, south, east, west } = boundingBox;
    return DEMO_STORM.strikeCache.filter(
      s => s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east
    );
  }
  return DEMO_STORM.strikeCache;
}

// ── Provider adaptors ─────────────────────────────────────────────────────────

async function fetchXweather(bbox) {
  const { XWEATHER_CLIENT_ID: id, XWEATHER_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('XWEATHER_CLIENT_ID / XWEATHER_CLIENT_SECRET not set');

  const { north, south, east, west } = bbox;
  const url = `https://data.api.xweather.com/lightning/search` +
    `?p=${south},${west},${north},${east}` +
    `&limit=500&client_id=${id}&client_secret=${secret}`;

  const res  = await fetch(url);
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.description || 'Xweather error');

  return (data.response || []).map(r => ({
    id:        r.id || `xw-${r.ob?.timestamp}-${Math.random()}`,
    lat:       r.loc?.lat,
    lon:       r.loc?.long,
    time:      (r.ob?.timestamp || 0) * 1000,
    type:      r.ob?.type === 1 ? 'CG' : r.ob?.type === 2 ? 'IC' : 'unknown',
    amplitude: r.ob?.peakamp ?? null,
    error:     r.ob?.semimajoraxis ?? null,
    stations:  r.ob?.sensorcount ?? null,
  }));
}

async function fetchAmbee(bbox) {
  const key = process.env.AMBEE_API_KEY;
  if (!key) throw new Error('AMBEE_API_KEY not set');

  const { north, south, east, west } = bbox;
  const url = `https://api.ambeedata.com/lightning/latest/by-lat-lng` +
    `?lat=${(north + south) / 2}&lng=${(east + west) / 2}`;

  const res  = await fetch(url, { headers: { 'x-api-key': key } });
  const data = await res.json();

  return (data.data || []).map((r, i) => ({
    id:        `ambee-${r.timestamp}-${i}`,
    lat:       r.lat,
    lon:       r.lng,
    time:      new Date(r.timestamp).getTime(),
    type:      r.type || 'unknown',
    amplitude: null,
    error:     null,
    stations:  null,
  }));
}

async function fetchCustom(bbox) {
  const url = process.env.CUSTOM_LIGHTNING_URL;
  const key = process.env.CUSTOM_API_KEY;
  if (!url) throw new Error('CUSTOM_LIGHTNING_URL not set');

  const { north, south, east, west } = bbox;
  const requestUrl = `${url}?north=${north}&south=${south}&east=${east}&west=${west}`;
  const headers = key ? { Authorization: `Bearer ${key}` } : {};

  const res  = await fetch(requestUrl, { headers });
  const data = await res.json();

  // Expects the custom endpoint to return our normalised schema already,
  // or an array of objects with at minimum { lat, lon, time } fields.
  return (Array.isArray(data) ? data : data.strikes || data.data || []).map((r, i) => ({
    id:        r.id || `custom-${r.time || Date.now()}-${i}`,
    lat:       r.lat,
    lon:       r.lon || r.lng || r.longitude,
    time:      typeof r.time === 'string' ? new Date(r.time).getTime() : r.time,
    type:      r.type || 'unknown',
    amplitude: r.amplitude ?? r.peakamp ?? null,
    error:     r.error ?? r.accuracy ?? null,
    stations:  r.stations ?? r.sensorCount ?? null,
  }));
}

// ── /api/strikes ──────────────────────────────────────────────────────────────
app.get('/api/strikes', async (req, res) => {
  try {
    const north = parseFloat(req.query.north || '90');
    const south = parseFloat(req.query.south || '-90');
    const east  = parseFloat(req.query.east  || '180');
    const west  = parseFloat(req.query.west  || '-180');
    const bbox  = { north, south, east, west };

    let strikes;
    switch (PROVIDER) {
      case 'xweather':  strikes = await fetchXweather(bbox); break;
      case 'ambee':     strikes = await fetchAmbee(bbox);    break;
      case 'custom':    strikes = await fetchCustom(bbox);   break;
      default:          strikes = demoStrikes(bbox);         break;
    }

    res.json({
      provider: PROVIDER,
      demo:     PROVIDER === 'demo',
      count:    strikes.length,
      strikes,
    });
  } catch (err) {
    console.error('[/api/strikes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/provider ─────────────────────────────────────────────────────────────
app.get('/api/provider', (_req, res) => {
  res.json({ provider: PROVIDER, demo: PROVIDER === 'demo' });
});

// ── Fallback → index.html ─────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));

});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Lightning Tracker running on http://0.0.0.0:${PORT}`);
  console.log(`   Provider: ${PROVIDER.toUpperCase()}${PROVIDER === 'demo' ? ' (simulated data)' : ''}`);
});
