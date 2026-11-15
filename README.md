# The Earth Jukebox: 20-Day Hazard Outlook

NASA Earth-science sonification observatory, extended with a **click-anywhere hazard agent**:
click the map and get a 20-day outlook for **wildfire, flood and tsunami** risk at that spot, the
**local emergency numbers and agencies** for the country, and **safety measures** for each hazard.

## What it does

| Layer | Data | Role |
|---|---|---|
| Wildfire | NASA POWER (rain, soil wetness, temp, humidity, wind, 1991-2020 climatology), NASA FIRMS (VIIRS fire detections), NASA EONET (open fires) | Fire-danger index per day |
| Flood | NASA POWER (rain, soil wetness), NASA EONET (open floods), Open-Meteo forecast + GloFAS river discharge | Flood-potential index per day |
| Tsunami | USGS earthquake catalogue (NASA publishes no open tsunami feed), Reasenberg-Jones aftershock model, elevation | Probability of an M7+ trigger quake x coastal exposure |
| Map overlay | NASA EONET open events | Live fire / flood / storm / volcano / landslide markers |
| Agent | Deterministic rules always; Gemini narration optional | Plain-language briefing grounded only in the computed facts |
| Safety | Curated static directory (45+ countries) + hazard guidance | **Never LLM-generated** |

Scores are transparent indices, not calibrated probabilities (except the tsunami trigger probability).
See [docs/METHODOLOGY.md](docs/METHODOLOGY.md) for formulas and limits. **This is not an official warning system.**

## Run

```bash
npm install
cp .env.example .env.local      # all keys optional; see comments inside
npm run dev                     # http://localhost:3000
npm test                        # 53 unit + HTTP integration tests (offline)
npm run check:providers         # live smoke test of every upstream API (needs internet)
npm run build && npm run audit:bundle && npm start
```

Requires Node >= 22.18 (runs TypeScript directly; no server build step).

Keys (all optional, all server-side only):
* `FIRMS_MAP_KEY` free at <https://firms.modaps.eosdis.nasa.gov/api/map_key/>: adds satellite fire detections.
* `GEMINI_API_KEY`: adds AI briefing + frame narrator. Without it, rule-based briefings are used.

## Architecture

```
shared/types.ts          types shared by server + client
server/
  index.ts               entrypoint (node:http, no framework), Vite in dev only
  app.ts                 routing, static files, per-route limits, error handling
  config.ts              validated env config (fails fast, never prints secrets)
  security/              headers/CSP, rate limiter + daily budget, origin guard, body/JSON/image validation
  net/                   upstream client (HTTPS + host allowlist, size/time caps), TTL cache
  providers/             NASA POWER / FIRMS / EONET, USGS, Open-Meteo, Nominatim (parsers are pure + tested)
  risk/                  weather timeline, wildfire, flood, tsunami models
  safety/                emergency directory + per-hazard guidance
  agent/                 rule-based + Gemini briefing, output sanitiser
  assess.ts              orchestrates providers in parallel, tolerates partial outages
src/                     React client (RiskReportPanel, hook, API client, map overlay)
```

API: `GET /api/risk?lat&lon`, `POST /api/brief`, `GET /api/events`, `POST /api/describe-frame`, `GET /api/health`.

## Security

Read [docs/SECURITY.md](docs/SECURITY.md): threat model, what was wrong in the original, what is fixed, and what
you must still do at deploy time (key restrictions, proxy hops, WAF).
