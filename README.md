# Ramp Board — AeroAPI Backend Starter

A small server that sits between your Ramp Schedule Board and FlightAware's
AeroAPI. Your API key lives here, on the server — never in the board's HTML,
where anyone opening the file could see and misuse it.

## What this does

`GET /api/flights?airline=DAL` → calls FlightAware's AeroAPI with your key →
returns a simplified list of that airline's current flights as JSON.

## 1. Local setup (test it on your own computer first)

```bash
npm install
AEROAPI_KEY=your_real_key_here npm start
```

Then visit `http://localhost:3000/api/flights?airline=DAL` in your browser
(swap DAL for any airline's ICAO or IATA code) — you should get back JSON.

If you see `"Server is missing AEROAPI_KEY"`, the environment variable
wasn't picked up — double check the command above.

## 2. Deploying it somewhere permanent

Pick one (all have free or cheap tiers for something this small):

- **Render** (render.com) — connect a GitHub repo, it builds and deploys
  automatically. Add `AEROAPI_KEY` under Environment in the dashboard.
- **Railway** (railway.app) — similar flow, very quick to get running.
- **Fly.io** — a bit more setup, more control.

Whichever you pick, the steps are the same shape:
1. Push this folder to a GitHub repo (or upload directly, depending on host)
2. Set `AEROAPI_KEY` as an environment variable in the host's dashboard —
   never commit it into the code or into GitHub
3. Deploy — you'll get a live URL like `https://your-app.onrender.com`

## 3. Point the board at it

In `server.js`, update `ALLOWED_ORIGINS` to include the real domain where
your board is hosted (e.g. your Netlify URL or WordPress domain) — this is
what allows the browser to actually call your server.

Then, in the board's code, replace manual flight entry with a call like:

```js
fetch('https://your-app.onrender.com/api/flights?airline=DAL')
  .then(r => r.json())
  .then(data => {
    // data.flights is an array of { flightNumber, origin, destination,
    // scheduledDeparture, scheduledArrival, gate, status }
  });
```

## Costs to expect

- **AeroAPI**: free for 30 days on a trial, then paid per request beyond
  that — check FlightAware's current pricing before relying on this.
- **Hosting**: usually free at this scale; a few dollars a month if usage
  grows.

## Notes

- This starter maps AeroAPI's response into a simpler shape for the board.
  If you want more fields (aircraft type, delay info, etc.), adjust the
  `simplified` mapping in `server.js`.
- Airline codes: AeroAPI accepts both ICAO (3-letter, e.g. `DAL`) and IATA
  (2-letter, e.g. `DL`) codes for most operators.
