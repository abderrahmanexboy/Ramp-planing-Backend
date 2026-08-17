/**
 * Ramp Board — AeroAPI backend starter
 * ------------------------------------
 * A small server that sits between your Ramp Schedule Board and
 * FlightAware's AeroAPI. Your AeroAPI key stays here, on the server,
 * and never gets sent to the browser.
 *
 * SETUP
 * 1. npm init -y
 * 2. npm install express cors node-fetch@2
 * 3. Set your API key as an environment variable named AEROAPI_KEY
 *    (never hard-code it in this file). On most hosts (Render, Railway,
 *    Fly.io) you set this in the dashboard under "Environment Variables".
 *    Locally, you can run:  AEROAPI_KEY=your_key_here node server.js
 * 4. node server.js
 *
 * USAGE FROM THE BOARD
 *   fetch('https://your-server.com/api/flights?airline=DAL')
 *     .then(r => r.json())
 *     .then(data => console.log(data));
 *
 * `airline` should be the airline's ICAO or IATA code (e.g. "DAL" or "DL"
 * for Delta, "UAL" or "UA" for United). AeroAPI accepts either.
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // v2 for CommonJS require()

const app = express();
const PORT = process.env.PORT || 3000;
const AEROAPI_KEY = process.env.AEROAPI_KEY;
const AEROAPI_BASE = 'https://aeroapi.flightaware.com/aeroapi';

if (!AEROAPI_KEY) {
  console.warn('WARNING: AEROAPI_KEY is not set. Requests to AeroAPI will fail until it is.');
}

// ---------------------------------------------------------------------
// CORS: only allow your board's actual domain(s) to call this server.
// Replace these placeholder origins with wherever you end up hosting
// the board (e.g. your Netlify URL, or your WordPress domain).
// ---------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://your-board-domain.com',
  'http://localhost:3000', // handy for local testing
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like curl/Postman) during testing
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// ---------------------------------------------------------------------
// GET /api/flights?airline=DAL
// Returns that airline's current scheduled/enroute flights.
// ---------------------------------------------------------------------
app.get('/api/flights', async (req, res) => {
  const airline = (req.query.airline || '').trim();
  if (!airline) {
    return res.status(400).json({ error: 'Missing required query param: airline (ICAO or IATA code, e.g. DAL or DL)' });
  }
  if (!AEROAPI_KEY) {
    return res.status(500).json({ error: 'Server is missing AEROAPI_KEY — set it as an environment variable.' });
  }

  try {
    const url = `${AEROAPI_BASE}/operators/${encodeURIComponent(airline)}/flights`;
    const response = await fetch(url, {
      headers: { 'x-apikey': AEROAPI_KEY }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: `AeroAPI returned ${response.status}`,
        details: text
      });
    }

    const data = await response.json();

    // Reshape into just what the board needs, so the frontend stays simple.
    // AeroAPI's raw response nests flights under a few different buckets
    // depending on status (scheduled, enroute, arrived, etc) — adjust this
    // mapping if you want more/less detail on the board.
    const allFlights = [
      ...(data.scheduled || []),
      ...(data.enroute || []),
      ...(data.arrived || []),
    ];

    const simplified = allFlights.map(f => ({
      flightNumber: f.ident || f.flight_number || '',
      origin: f.origin ? f.origin.code : '',
      destination: f.destination ? f.destination.code : '',
      scheduledDeparture: f.scheduled_out || f.scheduled_off || '',
      scheduledArrival: f.scheduled_in || f.scheduled_on || '',
      gate: f.gate_origin || f.gate_destination || '',
      status: f.status || ''
    }));

    res.json({ airline, count: simplified.length, flights: simplified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach AeroAPI', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Ramp Board AeroAPI backend is running. Try /api/flights?airline=DAL');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
