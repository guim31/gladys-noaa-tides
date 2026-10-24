// -----------------------------------------------------------------------------
// The NOAA parsing and the tide arithmetic, on the recorded answers, and the
// configuration parsing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAlertLevels, parseStations } from '../src/config.js';
import {
  NoaaClient,
  displayName,
  formatBegin,
  parseCurve,
  parseDetails,
  parseExtremes,
  parseLatest,
  parseStation,
} from '../src/noaa.js';
import { cosineLevel, levelAt, minutesBetween, nextTide, trendAt } from '../src/tides.js';
import {
  BATTERY,
  BOSTON,
  HULL,
  SAN_FRANCISCO,
  START,
  createApi,
  fixture,
} from './helpers/world.js';

test('station names lose the capitals of the reference stations, not the others', () => {
  assert.equal(displayName('SAN FRANCISCO (Golden Gate)'), 'San Francisco (Golden Gate)');
  assert.equal(displayName('NEW YORK (The Battery)'), 'New York (The Battery)');
  assert.equal(displayName('Ebon (Boston) Atoll'), 'Ebon (Boston) Atoll');
  assert.equal(displayName('TPT2705'), 'TPT2705');
  const hull = fixture('stations.json').stations.find((raw) => raw.id === HULL);
  assert.deepEqual(parseStation(hull), {
    id: HULL,
    name: 'Hull',
    state: 'MA',
    latitude: 42.3033,
    longitude: -70.92,
    reference: false,
  });
});

test('details: active sensors and the minor flood level above MLLW', () => {
  // San Francisco: water temperature sensor out of service (status 0).
  assert.deepEqual(parseDetails(fixture(`details-${SAN_FRANCISCO}.json`)), {
    waterLevel: true,
    waterTemperature: false,
    minorFlood: 2.351,
  });
  assert.deepEqual(parseDetails(fixture(`details-${BATTERY}.json`)), {
    waterLevel: true,
    waterTemperature: true,
    minorFlood: 2.103,
  });
  assert.deepEqual(parseDetails(fixture(`details-${BOSTON}.json`)), {
    waterLevel: true,
    waterTemperature: false,
    minorFlood: 3.756,
  });
  // A subordinate station has no sensor, no datum.
  assert.deepEqual(parseDetails(fixture(`details-${HULL}.json`)), {
    waterLevel: false,
    waterTemperature: false,
    minorFlood: null,
  });
});

test('predictions and observations are read in GMT', () => {
  const extremes = parseExtremes(fixture(`hilo-${SAN_FRANCISCO}.json`));
  assert.ok(extremes.length >= 14);
  assert.deepEqual(extremes[0], {
    at: Date.parse('2026-10-23T04:43:00Z'),
    height: 1.476,
    type: 'H',
  });
  const curve = parseCurve(fixture(`curve-${SAN_FRANCISCO}.json`));
  assert.equal(curve[1].at - curve[0].at, 6 * 60 * 1000);
  assert.deepEqual(
    parseLatest(fixture(`wl-${BATTERY}.json`)).at,
    Date.parse('2026-10-24T09:18:00Z'),
  );
  assert.equal(parseLatest(fixture(`wt-${BOSTON}.json`)), null);
  assert.equal(formatBegin(Date.parse('2026-10-24T09:05:00Z')), '20261024 09:05');
});

test('the client asks metric, GMT, MLLW, names the application, and tells no data from an outage', async () => {
  const api = createApi();
  const client = new NoaaClient({ fetch: api.fetch });
  assert.equal((await client.extremes(BOSTON, START, 96)).length > 10, true);
  const url = api.requests.at(-1);
  for (const [key, value] of Object.entries({
    product: 'predictions',
    interval: 'hilo',
    datum: 'MLLW',
    units: 'metric',
    time_zone: 'gmt',
    application: 'gladys-noaa-tides',
  })) {
    assert.equal(url.searchParams.get(key), value, key);
  }
  // A subordinate station has no 6-minute curve, no water level (HTTP 400).
  assert.deepEqual(await client.curve(HULL, START, 36), []);
  assert.equal(await client.latest(HULL, 'water_level'), null);
  assert.equal(await client.latest(BOSTON, 'water_temperature'), null);
  api.down = 503;
  await assert.rejects(client.latest(BOSTON, 'water_level'), /HTTP 503/);
  api.down = 'network';
  await assert.rejects(client.stations(), /fetch failed/);
});

test('levels: the curve where it exists, else the cosine between the tides', () => {
  const extremes = parseExtremes(fixture(`hilo-${SAN_FRANCISCO}.json`));
  const curve = parseCurve(fixture(`curve-${SAN_FRANCISCO}.json`));
  const high = extremes.find((tide) => tide.type === 'H' && tide.at > START);
  // At a tide, both give its height (the curve to a few millimetres).
  assert.ok(Math.abs(levelAt({ curve, extremes }, high.at) - high.height) < 0.01);
  assert.equal(levelAt({ curve: [], extremes }, high.at), high.height);
  // Between two points of the curve: linear.
  const middle = (curve[10].at + curve[11].at) / 2;
  assert.equal(levelAt({ curve, extremes }, middle), (curve[10].height + curve[11].height) / 2);
  // The cosine stays close to the curve (the harmonic prediction).
  for (let at = START; at < START + 24 * 3600e3; at += 1800e3) {
    const exact = levelAt({ curve, extremes }, at);
    assert.ok(Math.abs(levelAt({ curve: [], extremes }, at) - exact) < 0.15, new Date(at));
  }
  const previous = { at: 0, height: 2 };
  const next = { at: 100, height: 0 };
  assert.equal(cosineLevel(previous, next, 50), 1);
  assert.equal(levelAt({ curve: [], extremes: [] }, START), null);
});

test('next tide, trend, minutes', () => {
  const extremes = parseExtremes(fixture(`hilo-${BOSTON}.json`));
  const next = nextTide(extremes, START);
  assert.equal(next.type, 'H');
  assert.equal(trendAt(extremes, START), 'rising');
  assert.equal(nextTide(extremes, START, 'L').type, 'L');
  assert.equal(trendAt([], START), null);
  assert.equal(minutesBetween(START, START + 90.4 * 60e3), 90);
  assert.equal(minutesBetween(START, START - 60e3), 0);
});

test('configuration: ids, pages, names, alert levels with a decimal comma', () => {
  assert.deepEqual(
    parseStations(
      '9414290, boston; https://tidesandcurrents.noaa.gov/stationhome.html?id=8518750\nTPT2705, 9414290',
    ).map((token) => [token.kind, token.value]),
    [
      ['id', '9414290'],
      ['name', 'boston'],
      ['id', '8518750'],
      ['id', 'TPT2705'],
    ],
  );
  assert.deepEqual(parseAlertLevels('2,1'), { all: 2.1, byStation: {} });
  assert.deepEqual(parseAlertLevels('9414290=2,1; 8443970: 3.6, 1.5, x=y'), {
    all: 1.5,
    byStation: { 9414290: 2.1, 8443970: 3.6 },
  });
  assert.deepEqual(normalizeConfig({}), {
    stations: [],
    imperial: false,
    alertLevels: { all: null, byStation: {} },
    language: 'fr',
  });
  assert.equal(normalizeConfig({ units: 'imperial', language: 'xx' }).imperial, true);
});
