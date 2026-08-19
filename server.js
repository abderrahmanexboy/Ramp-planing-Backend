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

    let simplified = allFlights.map(f => {
      const ident = f.ident || f.flight_number || '';
      return {
        flightNumber: ident,
        faFlightId: f.fa_flight_id || '',
        // AeroAPI gives explicit operator codes — use those directly rather
        // than guessing from the ident string, since airlines are commonly
        // entered by their IATA code (2 letters, e.g. "KE") which often
        // differs from the ICAO code embedded in the ident (e.g. "KAL123").
        operatorIcao: (f.operator_icao || '').toUpperCase(),
        operatorIata: (f.operator_iata || f.operator || '').toUpperCase(),
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
      simplified = simplified.filter(f =>
        airlineFilter.includes(f.operatorIcao) || airlineFilter.includes(f.operatorIata)
      );
    }

    // The board just wants one "airline" code to display/match against —
    // prefer whichever one the caller's filter actually matched, falling
    // back to ICAO then IATA.
    simplified = simplified.map(f => ({
      flightNumber: f.flightNumber,
      faFlightId: f.faFlightId,
      airline: (airlineFilter && airlineFilter.includes(f.operatorIata)) ? f.operatorIata : (f.operatorIcao || f.operatorIata),
      origin: f.origin,
      destination: f.destination,
      scheduledDeparture: f.scheduledDeparture,
      scheduledArrival: f.scheduledArrival,
      arrGate: f.arrGate,
      depGate: f.depGate,
      status: f.status
    }));

    res.json({ airport, count: simplified.length, flights: simplified });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach AeroAPI', details: err.message });
  }
});

// ---------------------------------------------------------------------
// GET /api/scheduled-flights?airport=KBOS&airlines=DAL,JBU&start=2026-08-20&end=2026-08-21&direction=arrivals
//
// For FUTURE dates. Uses AeroAPI's Published Schedules resource
// (/schedules/{start}/{end}), which is separate from /airports/{id}/flights —
// that one reflects live/current operational tracking (today-ish), while
// this one is the airline's advance published timetable, available up to
// about a year out. Two honest limitations of this data source:
//   1. Gate assignments usually aren't published this far ahead — expect
//      arrGate/depGate to come back empty for anything beyond a day or two.
//   2. Schedules are provisional and can change closer to the actual day.
//
// start/end are calendar dates (YYYY-MM-DD). `direction` is optional:
//   'arrivals'   -> only flights landing AT the airport
//   'departures' -> only flights leaving FROM the airport
//   (anything else / omitted) -> both, which costs 2 AeroAPI calls per
//   airline instead of 1 — mind your usage on multi-airline / wide
//   date-range requests either way.
// ---------------------------------------------------------------------
app.get('/api/scheduled-flights', async (req, res) => {
  const airport = (req.query.airport || '').trim();
  const airlinesParam = (req.query.airlines || '').trim();
  const start = (req.query.start || '').trim();
  const end = (req.query.end || '').trim();
  const direction = (req.query.direction || 'both').trim().toLowerCase();
  const airlineCodes = airlinesParam ? airlinesParam.split(',').map(a => a.trim()).filter(Boolean) : [];

  if (!airport || !start || !end || airlineCodes.length === 0) {
    return res.status(400).json({ error: 'Missing required params: airport, start, end (YYYY-MM-DD), airlines' });
  }
  if (!AEROAPI_KEY) {
    return res.status(500).json({ error: 'Server is missing AEROAPI_KEY — set it as an environment variable.' });
  }

  // 'destination' = flights landing AT the airport (arrivals);
  // 'origin' = flights leaving FROM the airport (departures).
  const directionParams =
    direction === 'arrivals' ? ['destination'] :
    direction === 'departures' ? ['origin'] :
    ['origin', 'destination'];

  const seen = new Set();
  const allFlights = [];
  const errors = [];

  for (const code of airlineCodes) {
    for (const directionParam of directionParams) {
      try {
        const params = new URLSearchParams({ airline: code, [directionParam]: airport });
        const url = `${AEROAPI_BASE}/schedules/${start}/${end}?${params.toString()}`;
        const response = await fetch(url, { headers: { 'x-apikey': AEROAPI_KEY } });
        if (!response.ok) {
          const text = await response.text();
          errors.push(`${code} (${directionParam}=${airport}): ${response.status} ${text.slice(0,150)}`);
          continue;
        }
        const data = await response.json();
        const scheduled = data.scheduled || [];
        // Each /schedules record is ONE leg of a flight (e.g. Boston -> City X,
        // or City Y -> Boston) — it is NOT a full turnaround at this airport.
        // scheduled_out is when it leaves its ORIGIN, scheduled_in is when it
        // lands at its DESTINATION. Only one of those two times is actually
        // about THIS airport, depending on which query found it — the other
        // belongs to a completely different city and must not be shown as if
        // it were this flight's Boston time.
        const isArrivalHere = directionParam === 'destination';
        // Normalizes an airport code so "KBOS" and "BOS" compare equal —
        // most continental US airports' ICAO code is just "K" + the IATA
        // code, but AeroAPI doesn't always provide both fields on every
        // record, so comparing the raw strings directly can miss genuine
        // matches.
        const airportCore = (code) => {
          if (!code) return '';
          const c = code.toUpperCase();
          return (c.length === 4 && c.startsWith('K')) ? c.slice(1) : c;
        };
        const airportUpperCore = airportCore(airport);
        scheduled.forEach(f => {
          // AeroAPI's own origin/destination filter on this endpoint isn't
          // fully reliable — it can return flights that don't actually touch
          // the requested airport at all. Independently verify using the
          // airport codes actually present on the flight record itself
          // (checking both ICAO and IATA forms) before trusting it.
          const relevantCodes = isArrivalHere
            ? [f.destination, f.destination_icao, f.destination_iata]
            : [f.origin, f.origin_icao, f.origin_iata];
          const actuallyMatchesAirport = relevantCodes
            .filter(Boolean)
            .some(c => airportCore(c) === airportUpperCore);
          if (!actuallyMatchesAirport) return; // discard — not really a Boston flight

          const key = f.fa_flight_id || (f.ident + '-' + f.scheduled_out);
          if (seen.has(key)) return;
          seen.add(key);
          // Use the MARKETING flight number — the one that actually starts
          // with this airline's own code — not `actual_ident*`. That field
          // can belong to a completely different operating carrier on a
          // codeshare (e.g. a Turkish Airlines-marketed seat actually flown
          // by a partner), which would show a mismatched airline label next
          // to a flight number from someone else's fleet. Prefer IATA format
          // (2-letter, e.g. "TP215") over ICAO (3-letter, e.g. "TAP215")
          // since that's the format ramp ops actually uses day to day.
          const flightNumber = f.ident_iata || f.ident || '';
          // Final sanity check: the flight number should actually start with
          // the airline code we searched for. If it doesn't, something's
          // mismatched in the data — better to drop it than show a
          // confusing airline/number pairing.
          if (flightNumber && !flightNumber.toUpperCase().startsWith(code.toUpperCase())) return;

          // Exclude codeshares actually OPERATED by a different airline.
          // `actual_ident*` is only present when this flight is a codeshare;
          // when it is, that field tells you who's really flying the plane.
          // If that's a different carrier than the one being searched for,
          // this isn't really "that airline's" flight — it's a partner's
          // aircraft sold under this airline's brand — so leave it out.
          const actualOperatorIdent = f.actual_ident_iata || f.actual_ident || '';
          if (actualOperatorIdent && !actualOperatorIdent.toUpperCase().startsWith(code.toUpperCase())) return;

          allFlights.push({
            flightNumber,
            faFlightId: f.fa_flight_id || '',
            airline: code,
            origin: f.origin_iata || f.origin || '',
            destination: f.destination_iata || f.destination || '',
            direction: isArrivalHere ? 'arrival' : 'departure',
            // Only the time relevant to THIS airport is included — the other
            // is left blank rather than filled with an unrelated city's time.
            scheduledArrival: isArrivalHere ? (f.scheduled_in || '') : '',
            scheduledDeparture: isArrivalHere ? '' : (f.scheduled_out || ''),
            arrGate: '', // not published this far ahead — fill in manually once known
            depGate: '',
            status: 'Scheduled'
          });
        });
      } catch (err) {
        errors.push(`${code} (${directionParam}=${airport}): ${err.message}`);
      }
    }
  }

  res.json({ airport, start, end, count: allFlights.length, flights: allFlights, errors: errors.length ? errors : undefined });
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
  res.send('Ramp Board AeroAPI backend is running. Live: /api/airport-flights?airport=KBOS&airlines=DAL,JBU — Future dates: /api/scheduled-flights?airport=KBOS&airlines=DAL,JBU&start=2026-08-20&end=2026-08-21');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
