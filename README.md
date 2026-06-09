# ⚡ StrikeLive — Lightning Tracker

A mobile-first live lightning strike tracker built with Leaflet, Node.js, and an API-key-safe proxy server.

---

## Features

- **Live map** with animated pulse markers — rings ripple outward from each detected strike
- **Age fading** — markers fade as strikes get older
- **Time filters** — 5 min / 30 min / 1 h / 24 h
- **Distance alerts** — notify if a strike is within 5, 10, 20, or 50 miles of you
- **Sound alerts** — synthesised thunder rumble (Web Audio API, no files needed)
- **Sidebar / bottom panel** — lists recent strikes with time, distance, type, amplitude, and location error radius
- **Locate button** — centres map on your GPS position
- **Mobile-first** — bottom panel on small screens, sidebar on desktop
- **API key stays on the server** — the frontend only calls `/api/strikes`
- **Demo mode** — works out of the box with realistic simulated data

---

## Quick start (demo mode)

```bash
npm install
node server.js
# Open http://localhost:3000
```

No API key needed — the app runs with simulated storm data by default.

---

## Connecting a real lightning API

Copy `.env.example` to `.env` and configure your chosen provider.

### Option A — Xweather (formerly Aeris Weather)
High-quality global lightning. Free tier available.
1. Sign up at https://www.xweather.com
2. Create an app to get a Client ID and Client Secret
3. In `.env`:
   ```
   LIGHTNING_PROVIDER=xweather
   XWEATHER_CLIENT_ID=your_client_id
   XWEATHER_CLIENT_SECRET=your_client_secret
   ```

### Option B — Ambee
Simple REST API with good coverage.
1. Sign up at https://www.getambee.com
2. Get your API key from the dashboard
3. In `.env`:
   ```
   LIGHTNING_PROVIDER=ambee
   AMBEE_API_KEY=your_api_key
   ```

### Option C — Custom endpoint
If you have your own lightning data source or want to proxy a different provider:
1. Build an endpoint that accepts `?north=&south=&east=&west=` query params
2. Return JSON in the normalised format (see below) or the server will try to auto-map common fields
3. In `.env`:
   ```
   LIGHTNING_PROVIDER=custom
   CUSTOM_LIGHTNING_URL=https://your-api.example.com/lightning
   CUSTOM_API_KEY=optional_key
   ```

---

## Normalised strike schema

All providers are mapped to this internal format:

```json
{
  "id":        "unique-string",
  "lat":       51.5074,
  "lon":       -0.1278,
  "time":      1700000000000,
  "type":      "CG",
  "amplitude": -42.3,
  "error":     0.8,
  "stations":  12
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `lat` / `lon` | Decimal degrees |
| `time` | Unix timestamp in **milliseconds** |
| `type` | `CG` (Cloud→Ground), `IC` (Intra-Cloud), `CC` (Cloud↔Cloud), `unknown` |
| `amplitude` | Peak current in kA — positive = positive stroke, negative = negative |
| `error` | Location error radius in km (null if unknown) |
| `stations` | Number of detection stations that contributed |

---

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/strikes?north=&south=&east=&west=` | Returns strikes within the bounding box |
| `GET /api/provider` | Returns `{ provider, demo }` |

---

## Adding new providers

Add a new `fetchXxx(bbox)` async function in `server.js` that returns an array of normalised strike objects, then add a case to the `switch` in the `/api/strikes` handler.

---

## Deployment notes

- Set `ALLOWED_ORIGIN=https://yourdomain.com` in production to restrict CORS
- The server serves the static frontend itself — no separate web server needed
- Works on any Node.js 16+ host (Railway, Render, Fly.io, etc.)
- Environment variables must be set on the host — never commit `.env`

---

## Disclaimer

> Strike positions are **estimated detection locations** based on electromagnetic triangulation. They are not guaranteed to represent the exact point where lightning contacted the ground. Always follow official severe weather guidance and do not use this app to make safety decisions.

---

## Tech stack

- **Backend**: Node.js + Express + node-fetch
- **Frontend**: Vanilla JS + Leaflet 1.9 + CartoDB Dark tiles
- **Audio**: Web Audio API (no external files)
- **Styling**: Pure CSS custom properties — no framework
