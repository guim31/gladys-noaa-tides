// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle (the
// start, a configuration change, NOAA lost and back, a user action), never one
// line per cycle; a failure that repeats is logged once, plus one line when it
// is over. Never the house coordinates.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSTON, HOUSE, captureLogs, create, createWorld, tick } from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  assert.deepEqual(lines.map(strip), [
    '[INFO] [noaa-tides] Started: 1 station(s) followed, metres and °C',
  ]);
});

test('a normal day writes nothing at info', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON, alert_levels: '0.5' } });
  t.after(() => world.app.stop());
  await create(world, BOSTON);
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 24 * 12; i += 1) {
    await tick(world, 5);
  }
  assert.ok(world.fake.sceneEvents.length > 20, 'the triggers fired');
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the cycles, never the house coordinates', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  await create(world, BOSTON);
  await world.fake.action('search_stations', { query: '' });
  await tick(world, 1);
  assert.ok(lines.some((line) => /Refresh cycle: 1 station/.test(line.text)));
  const all = lines.map((line) => line.text).join('\n');
  assert.doesNotMatch(all, new RegExp(String(HOUSE.latitude).replace('.', '\\.')));
  assert.doesNotMatch(all, new RegExp(String(HOUSE.longitude).replace('.', '\\.')));
});

test('NOAA down for hours: one warning, then one line at recovery', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  await create(world, BOSTON);
  const lines = captureLogs(t, 'info');
  world.api.down = 'network';
  for (let i = 0; i < 40; i += 1) {
    await tick(world, 15);
  }
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[noaa-tides] NOAA unreachable: api.tidesandcurrents.noaa.gov: fetch failed']],
  );
  world.api.down = false;
  await tick(world, 15);
  assert.deepEqual(lines.slice(1).map(strip), ['[INFO] [noaa-tides] NOAA answers again']);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  await create(world, BOSTON);
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 3; i += 1) {
    await tick(world, 1);
  }
  assert.ok(publish.mock.callCount() >= 3);
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[noaa-tides] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await tick(world, 1);
  assert.match(lines.at(-1).text, /\[INFO\].*Publishing the states works again/);
});

test('an unknown station is one warning, not one per cycle', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: 'Nowhere' } });
  t.after(() => world.app.stop());
  for (let i = 0; i < 6; i += 1) {
    await tick(world, 30);
  }
  await world.fake.configUpdated({ stations: 'Nowhere' });
  assert.equal(lines.filter((line) => /Unknown station: Nowhere/.test(line.text)).length, 1);
});

test('NOAA down, cycles every minute: still one warning, no flapping status', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  await create(world, BOSTON);
  const lines = captureLogs(t, 'info');
  const statuses = world.fake.connectionStatuses.length;
  world.api.down = 503;
  for (let i = 0; i < 60; i += 1) {
    await tick(world, 1);
  }
  assert.equal(lines.length, 1, lines.map(strip).join('\n'));
  assert.equal(world.fake.connectionStatuses.length, statuses + 1);
  world.api.down = false;
  for (let i = 0; i < 15; i += 1) {
    await tick(world, 1);
  }
  assert.deepEqual(lines.slice(1).map(strip), ['[INFO] [noaa-tides] NOAA answers again']);
  assert.equal(world.fake.connectionStatuses.length, statuses + 2);
});

test('a station NOAA has no predictions for: one warning, asked again every 6 hours', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  world.api.answers[`hilo-${BOSTON}`] = {
    error: { message: 'No Predictions data was found. Please make sure the Datum input is valid.' },
  };
  world.monitor.data.stations = {};
  const lines = captureLogs(t, 'info');
  const asked = () =>
    world.api.requests.filter((url) => url.searchParams.get('interval') === 'hilo').length;
  const before = asked();
  for (let i = 0; i < 60; i += 1) {
    await tick(world, 6);
  }
  assert.equal(asked() - before, 1);
  assert.deepEqual(lines.map(strip), [
    `[WARN] [noaa-tides] Station ${BOSTON}: NOAA has no data for it (No Predictions data was found. Please make sure the Datum input is valid.)`,
  ]);
  assert.equal(world.fake.connectionStatus.connected, true, 'not an outage');
});
