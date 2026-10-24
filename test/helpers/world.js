// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake NOAA CO-OPS serving the
// answers recorded in test/fixtures/noaa (24/10/2026, 09:26 UTC), a manual
// clock, a temporary /data, and the integration wired on top through
// registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'America/New_York';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/noaa/${name}`, import.meta.url), 'utf8'));

// Recorded at 09:26 UTC: the clock starts at 09:30 UTC (05:30 in New York).
export const START = Date.parse('2026-10-24T09:30:00Z');

// San Francisco (Golden Gate): reference station, water level, water
// temperature sensor out of service (status 0) on 24/10/2026.
export const SAN_FRANCISCO = '9414290';
// The Battery, New York: reference station, water level and temperature.
export const BATTERY = '8518750';
// Boston: reference station, water level, no water temperature sensor.
export const BOSTON = '8443970';
// Hull (MA): subordinate station, high and low tides only.
export const HULL = '8444351';
export const STATIONS = [SAN_FRANCISCO, BATTERY, BOSTON, HULL];

// A house in Boston (public coordinates of the Old State House).
export const HOUSE = {
  id: 'house-1',
  name: 'Home',
  selector: 'home',
  latitude: 42.3588,
  longitude: -71.0578,
};

const error = (message) => ({ status: 400, body: { error: { message } } });

/** Fake NOAA. `api.down`: 'network' (connection refused), a status (503) or false. */
export function createApi() {
  const answers = {};
  for (const id of STATIONS) {
    for (const kind of ['hilo', 'curve', 'wl', 'wt', 'details']) {
      answers[`${kind}-${id}`] = fixture(`${kind}-${id}.json`);
    }
  }
  const api = {
    down: false,
    requests: [],
    stations: fixture('stations.json'),
    answers,

    /** Replace the latest water level of a station (metres, MLLW). */
    setLevel(id, at, value) {
      const iso = new Date(at).toISOString();
      answers[`wl-${id}`] = {
        metadata: { id },
        data: [{ t: `${iso.slice(0, 10)} ${iso.slice(11, 16)}`, v: value.toFixed(3) }],
      };
    },

    answer(url) {
      const params = url.searchParams;
      if (url.pathname === '/mdapi/prod/webapi/stations.json') {
        return params.get('type') === 'tidepredictions'
          ? { status: 200, body: api.stations }
          : null;
      }
      const details = /^\/mdapi\/prod\/webapi\/stations\/(\w+)\.json$/.exec(url.pathname);
      if (details) {
        const body = answers[`details-${details[1]}`];
        return body ? { status: 200, body } : { status: 404, body: { message: 'Not found' } };
      }
      if (
        url.pathname !== '/api/prod/datagetter' ||
        params.get('application') !== 'gladys-noaa-tides'
      ) {
        return null;
      }
      const station = params.get('station');
      const product = params.get('product');
      const key =
        product === 'predictions'
          ? `${params.get('interval') === 'hilo' ? 'hilo' : 'curve'}-${station}`
          : product === 'water_level'
            ? `wl-${station}`
            : product === 'water_temperature'
              ? `wt-${station}`
              : null;
      const body = answers[key];
      if (!body) {
        return error(
          'No data was found. This product may not be offered at this station at the requested time.',
        );
      }
      return { status: body.error ? 400 : 200, body };
    },

    async fetch(input) {
      const url = new URL(input);
      api.requests.push(url);
      if (api.down === 'network') {
        throw new TypeError('fetch failed');
      }
      if (api.down) {
        return { status: api.down, text: async () => '<html>Service Unavailable</html>' };
      }
      const answer = api.answer(url) ?? { status: 404, body: { message: 'Not found' } };
      return { status: answer.status, text: async () => JSON.stringify(answer.body) };
    },
  };
  return api;
}

/** A manual clock. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.timers] true: the monitor's own minute timer runs (mock it)
 */
export async function createWorld({
  config = {},
  devices = [],
  houses = [HOUSE],
  api = createApi(),
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-noaa-tides-')),
} = {}) {
  const gladys = createFakeGladys({ config, devices, houses });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, { store, fetch: api.fetch, timers, now: clock.now });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, api, clock, store, dataDir };
}

/** The device published for a station id, from the last discovery list. */
export const discovered = (world, id) =>
  world.fake.discoveredDevices.find((device) =>
    device.params.some((p) => p.name === 'STATION_ID' && p.value === id),
  );

/** Create the device of a station in Gladys, as the user would. */
export async function create(world, id) {
  const device = discovered(world, id);
  if (!device) {
    throw new Error(`${id} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Run one cycle, `minutes` later. */
export async function tick(world, minutes = 1) {
  world.clock.advance(minutes * 60 * 1000);
  await world.monitor.runCycle();
}

/** Capture the integration's log lines at `level` and above. */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
