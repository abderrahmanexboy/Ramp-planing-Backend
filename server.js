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
// Add your real hosted domain here once you have one (e.g. your Netlify
// URL or WordPress domain). 'null' is included because opening the board
// as a local file (file:///...) sends Origin: null — remove that once
// you're only using a real hosted URL, for tighter security.
// ---------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://your-board-domain.com',
  'http://localhost:3000', // handy for local testing
  'null', // allows opening the board directly as a local file for now
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
      arrGate: f.gate_destination || '',
      depGate: f.gate_origin || '',
      status: f.status || ''
    }));

    res.json({ airline, count: simplified.length, flights: simplified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach AeroAPI', details: err.message });
  }
});

// ---------------------------------------------------------------------
// GET /api/airport-flights?airport=KBOS&airlines=DAL,JBU,AAL
// Returns flights at a specific airport, optionally filtered down to
// only the airline codes you list (comma-separated ICAO codes). Leave
// `airlines` off to get everyone at that airport.
// ---------------------------------------------------------------------
app.get('/api/airport-flights', async (req, res) => {
  const airport = (req.query.airport || '').trim();
  const airlinesParam = (req.query.airlines || '').trim();
  const start = (req.query.start || '').trim(); // optional ISO8601, e.g. 2026-08-17T00:00:00Z
  const end = (req.query.end || '').trim();     // optional ISO8601 — pass both to widen the window (AeroAPI allows up to a few days out)
  const airlineFilter = airlinesParam
    ? airlinesParam.split(',').map(a => a.trim().toUpperCase()).filter(Boolean)
    : null;

  if (!airport) {
    return res.status(400).json({ error: 'Missing required query param: airport (ICAO code, e.g. KBOS for Boston Logan)' });
  }
  if (!AEROAPI_KEY) {
    return res.status(500).json({ error: 'Server is missing AEROAPI_KEY — set it as an environment variable.' });
  }

  try {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    const url = `${AEROAPI_BASE}/airports/${encodeURIComponent(airport)}/flights${qs ? '?' + qs : ''}`;
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

    // AeroAPI's airport endpoint can bucket flights under a few different
    // keys depending on status — gather whatever is present.
    const allFlights = [
      ...(data.arrivals || []),
      ...(data.departures || []),
      ...(data.scheduled_arrivals || []),
      ...(data.scheduled_departures || []),
      ...(data.enroute || []),
    ];

    // Extract the airline code from the flight ident (e.g. "DAL123" -> "DAL").
    const extractAirlineCode = (ident) => (ident || '').match(/^[A-Z]{2,3}/)?.[0] || '';

    let simplified = allFlights.map(f => {
      const ident = f.ident || f.flight_number || '';
      return {
        flightNumber: ident,
        faFlightId: f.fa_flight_id || '',
        airline: extractAirlineCode(ident),
        origin: f.origin ? f.origin.code : '',
        destination: f.destination ? f.destination.code : '',
        scheduledDeparture: f.scheduled_out || f.scheduled_off || '',
        scheduledArrival: f.scheduled_in || f.scheduled_on || '',
        // gate_destination = gate at this flight's destination (its arrival gate);
        // gate_origin = gate at this flight's origin (its departure gate).
        // AeroAPI usually only populates whichever one is relevant to this leg.
        arrGate: f.gate_destination || '',
        depGate: f.gate_origin || '',
        status: f.status || ''
      };
    });

    // De-dupe (airport endpoint can return the same flight in more than
    // one bucket, e.g. both "arrivals" and "scheduled_arrivals").
    const seen = new Set();
    simplified = simplified.filter(f => {
      const key = f.flightNumber + f.scheduledDeparture;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (airlineFilter) {
      simplified = simplified.filter(f => airlineFilter.includes(f.airline));
    }

    res.json({ airport, count: simplified.length, flights: simplified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach AeroAPI', details: err.message });
  }
});

// ---------------------------------------------------------------------
// GET /api/flight-status?faFlightId=XXXX   (preferred — exact flight instance)
//     or  /api/flight-status?ident=DAL123  (falls back to that ident's most
//     recent/current flight, less precise if the airline flies that number
//     more than once a day)
//
// Meant to be polled periodically by the board once a flight has taken off,
// to pull in actual/estimated times and current status. NOTE: each call
// costs against your AeroAPI usage — polling many flights frequently adds
// up fast. Keep the polling interval conservative (minutes, not seconds).
// ---------------------------------------------------------------------
app.get('/api/flight-status', async (req, res) => {
  const faFlightId = (req.query.faFlightId || '').trim();
  const ident = (req.query.ident || '').trim();

  if (!faFlightId && !ident) {
    return res.status(400).json({ error: 'Provide either faFlightId or ident.' });
  }
  if (!AEROAPI_KEY) {
    return res.status(500).json({ error: 'Server is missing AEROAPI_KEY — set it as an environment variable.' });
  }

  try {
    const lookupId = faFlightId || ident;
    const url = `${AEROAPI_BASE}/flights/${encodeURIComponent(lookupId)}`;
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
    const flights = data.flights || [];
    // If looked up by faFlightId, there should be exactly one match; if by
    // ident, take the most current one (first in the list).
    const f = faFlightId
      ? (flights.find(x => x.fa_flight_id === faFlightId) || flights[0])
      : flights[0];

    if (!f) {
      return res.status(404).json({ error: 'No matching flight found.' });
    }

    res.json({
      flightNumber: f.ident || '',
      faFlightId: f.fa_flight_id || '',
      status: f.status || '',
      scheduledDeparture: f.scheduled_out || f.scheduled_off || '',
      estimatedDeparture: f.estimated_out || f.estimated_off || '',
      actualDeparture: f.actual_out || f.actual_off || '',
      scheduledArrival: f.scheduled_in || f.scheduled_on || '',
      estimatedArrival: f.estimated_in || f.estimated_on || '',
      actualArrival: f.actual_in || f.actual_on || '',
      arrGate: f.gate_destination || '',
      depGate: f.gate_origin || '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach AeroAPI', details: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('Ramp Board AeroAPI backend is running. Try /api/airport-flights?airport=KBOS&airlines=DAL,JBU');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
