// -----------------------------------------------------------------------------
// The monitor against the fake Gladys and the recorded NOAA answers: states,
// units, the minute timer, the scene triggers, outages and restarts.
// The clock starts at 09:30 UTC (05:30 in New York) on 24/10/2026.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTERY,
  BOSTON,
  HULL,
  SAN_FRANCISCO,
  START,
  create,
  createClock,
  createWorld,
  discovered,
  featureId,
  tick,
} from './helpers/world.js';

const MINUTE = 60 * 1000;
const last = (world, device, key) => world.fake.lastState(featureId(device, key));
const statesOf = (world, device) =>
  world.fake.states.filter((state) =>
    state.device_feature_external_id.startsWith(`${device.external_id}:`),
  );

test('a created station gets every state at once: predictions, observations, texts', async (t) => {
  const world = await createWorld({ config: { stations: BATTERY, language: 'en' } });
  t.after(() => world.app.stop());
  const device = await create(world, BATTERY);
  // Recorded: high tide 1.64 m at 11:13 UTC, water level 1.65 m and 16.4 °C at 09:18 UTC.
  assert.equal(last(world, device, 'next_high_height'), 1.64);
  assert.equal(last(world, device, 'next_high_in'), 103);
  assert.equal(last(world, device, 'trend'), 'Rising');
  assert.equal(last(world, device, 'next_tide'), 'High tide at 7:13 AM (1.64 m)');
  assert.equal(last(world, device, 'observed_level'), 1.65);
  assert.equal(last(world, device, 'water_temperature'), 16.4);
  const level = last(world, device, 'level');
  assert.ok(level > 1.3 && level < 1.64, `predicted level ${level}`);
  assert.equal(
    new Set(statesOf(world, device).map((state) => state.device_feature_external_id)).size,
    device.features.length,
    'every feature has a state',
  );
});

test('the minute timer refreshes the states by itself, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const clock = createClock();
  const world = await createWorld({ config: { stations: BOSTON }, timers: true, clock });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  const before = last(world, device, 'next_high_in');
  const poll = t.mock.method(world.monitor, 'poll');
  for (let i = 0; i < 5; i += 1) {
    clock.advance(MINUTE);
    t.mock.timers.tick(MINUTE);
    await world.monitor.cycling;
  }
  assert.equal(last(world, device, 'next_high_in'), before - 5);
  assert.equal(poll.mock.callCount(), 0);
  assert.equal(discovered(world, BOSTON).should_poll, false);
});

test('only the changed states are published, the others every 12 hours', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  const count = () => statesOf(world, device).length;
  let before = count();
  await tick(world, 1);
  const published = statesOf(world, device).slice(before - count());
  // The countdowns and the level move; the next tide sentence and heights do not.
  const keys = new Set(published.map((state) => state.device_feature_external_id.split(':').pop()));
  assert.ok(!keys.has('next_tide') && !keys.has('next_high_height'), [...keys].join());
  before = count();
  await tick(world, 12 * 60 + 1);
  const heartbeat = statesOf(world, device)
    .slice(before)
    .map((state) => state.device_feature_external_id.split(':').pop());
  assert.ok(heartbeat.includes('next_low_height') || heartbeat.includes('next_high_height'));
});

test('a subordinate station: high and low tides only, the level by the cosine', async (t) => {
  const world = await createWorld({ config: { stations: 'hull' } });
  t.after(() => world.app.stop());
  const device = await create(world, HULL);
  assert.equal(device.features.length, 7);
  assert.equal(device.model, 'NOAA CO-OPS · subordinate station');
  assert.ok(
    !world.api.requests.some(
      (url) => url.searchParams.get('station') === HULL && url.searchParams.get('interval') === '6',
    ),
    'no curve asked for a subordinate station',
  );
  assert.equal(last(world, device, 'trend'), 'Montante');
  const level = last(world, device, 'level');
  assert.ok(level > 0 && level < 3.03, `level ${level}`);
  assert.match(last(world, device, 'next_tide'), /^Pleine mer à 10:21 \(3,03 m\)$/);
});

test('units: the states follow the features as created, feet after "Update"', async (t) => {
  const world = await createWorld({ config: { stations: BATTERY } });
  t.after(() => world.app.stop());
  const metric = await create(world, BATTERY);
  assert.equal(last(world, metric, 'next_high_height'), 1.64);
  // Imperial chosen, the device not updated yet: still metres.
  await world.fake.configUpdated({ stations: BATTERY, units: 'imperial' });
  await tick(world, 1);
  assert.equal(last(world, metric, 'next_high_height'), 1.64);
  const imperial = discovered(world, BATTERY);
  assert.equal(imperial.features.find((f) => f.external_id.endsWith(':level')).unit, 'feet');
  await world.fake.deviceUpdated(imperial);
  assert.equal(last(world, imperial, 'next_high_height'), 5.36);
  assert.equal(last(world, imperial, 'water_temperature'), 61.5);
  assert.match(last(world, imperial, 'next_tide'), /\(5,36 ft\)$/);
});

test('tide_upcoming fires once at each chosen offset, at the right minute', async (t) => {
  const world = await createWorld({ config: { stations: BATTERY, language: 'en' } });
  t.after(() => world.app.stop());
  const device = await create(world, BATTERY);
  // Next high tide: 11:13 UTC, 103 minutes after the start.
  const fired = [];
  for (let minute = 1; minute <= 110; minute += 1) {
    const before = world.fake.sceneEvents.length;
    await tick(world, 1);
    for (const event of world.fake.sceneEvents.slice(before)) {
      fired.push({ minute, ...event });
    }
  }
  const high = fired.filter((event) => event.data.tide === 'high');
  assert.deepEqual(
    high.map((event) => [event.minute, event.data.minutes_before]),
    [
      [13, '90'],
      [43, '60'],
      [58, '45'],
      [73, '30'],
      [88, '15'],
      [103, '0'],
    ],
  );
  assert.equal(high[0].data.station, device.external_id);
  assert.equal(
    high[0].data.summary,
    'High tide in 90 min at New York (The Battery): 7:13 AM, 1.64 m',
  );
  assert.equal(high.at(-1).data.summary, 'High tide now at New York (The Battery): 1.64 m');
  assert.equal(high.at(-1).data.tide_datetime, '2026-10-24T11:13:00.000Z');
  assert.ok(
    fired.every((event) => event.key === 'tide_upcoming'),
    'below the NOAA flood level',
  );
});

test('high_tide_above: the alert level of the configuration, per station, in its units', async (t) => {
  const world = await createWorld({
    config: {
      stations: `${BATTERY}, ${BOSTON}`,
      alert_levels: `${BOSTON}=3.1; 5.3`,
      units: 'imperial',
    },
  });
  t.after(() => world.app.stop());
  await create(world, BATTERY);
  await create(world, BOSTON);
  for (let minute = 0; minute < 24 * 60; minute += 5) {
    await tick(world, 5);
  }
  const above = world.fake.sceneEvents.filter((event) => event.key === 'high_tide_above');
  const at = (event) =>
    `${event.data.station.split(':').pop()} ${event.data.tide_datetime.slice(11, 16)} ${event.data.minutes_before}`;
  // Boston, 3.1 ft: every high tide (about 3 m). The Battery, 5.3 ft (1.62 m):
  // the 1.64 m high tide of 11:13 UTC only, not the 1.32 m one of the evening.
  assert.ok(
    above.some((event) => at(event) === `${BATTERY} 11:13 0`),
    above.map(at).join(),
  );
  assert.ok(!above.some((event) => at(event).startsWith(`${BATTERY} 23:`)), above.map(at).join());
  assert.ok(above.filter((event) => event.data.station.endsWith(BOSTON)).length >= 8);
  const battery = above.find((event) => at(event) === `${BATTERY} 11:13 0`);
  assert.equal(battery.data.alert_level, 5.3);
  assert.equal(battery.data.height, 5.36);
  assert.equal(battery.data.unit, 'ft');
  assert.equal(
    battery.data.summary,
    'Pleine mer de 5,36 ft (seuil 5,30 ft) maintenant à New York (The Battery)',
  );
});

test('without an alert level, the NOAA minor flood level: ordinary tides fire nothing', async (t) => {
  const world = await createWorld({ config: { stations: SAN_FRANCISCO } });
  t.after(() => world.app.stop());
  await create(world, SAN_FRANCISCO);
  assert.deepEqual(world.monitor.alertLevel(SAN_FRANCISCO), { metres: 2.351, source: 'noaa' });
  for (let minute = 0; minute < 24 * 60; minute += 10) {
    await tick(world, 10);
  }
  assert.equal(world.fake.sceneEvents.filter((e) => e.key === 'high_tide_above').length, 0);
  assert.equal(world.monitor.alertLevel(HULL), null);
});

test('a stopped container fires nothing for the minutes it missed, and nothing twice', async (t) => {
  const world = await createWorld({ config: { stations: BATTERY } });
  t.after(() => world.app.stop());
  await create(world, BATTERY);
  await tick(world, 1);
  await world.app.stop();
  // Restarted 40 minutes later (the 90 min event of 06:43 New York is missed),
  // on the same /data.
  const clock = createClock(world.clock.now() + 40 * MINUTE);
  const again = await createWorld({
    config: { stations: BATTERY },
    devices: world.fake.devices,
    dataDir: world.dataDir,
    clock,
  });
  t.after(() => again.app.stop());
  assert.deepEqual(again.fake.sceneEvents, []);
  await tick(again, 1);
  assert.deepEqual(again.fake.sceneEvents, []);
  // Restarted within the minute on the same /data: the next minute fires once.
  await again.app.stop();
  const third = await createWorld({
    config: { stations: BATTERY },
    devices: world.fake.devices,
    dataDir: world.dataDir,
    clock,
  });
  t.after(() => third.app.stop());
  const sixty = Date.parse('2026-10-24T10:13:00Z');
  clock.time = sixty - 30 * 1000;
  await third.monitor.runCycle();
  clock.time = sixty + 30 * 1000;
  await third.monitor.runCycle();
  await third.monitor.runCycle();
  assert.deepEqual(
    third.fake.sceneEvents.map((event) => event.data.minutes_before),
    ['60'],
  );
});

test('NOAA down: the known predictions keep the states going, one status, then recovery', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  world.api.down = 503;
  for (let i = 0; i < 10; i += 1) {
    await tick(world, 6);
  }
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  // The countdown still runs on the predictions known.
  assert.equal(last(world, device, 'next_high_in'), 286 - 60);
  const statuses = world.fake.connectionStatuses.length;
  world.api.down = false;
  await tick(world, 15);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.connectionStatuses.length, statuses + 1);
});

test('an unknown station is said on the Configuration screen; names find the reference station', async (t) => {
  const world = await createWorld({
    config: { stations: 'San Francisco, Nowhere, boston, 0000000' },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.monitor.followed.map((station) => station.id),
    [SAN_FRANCISCO, BOSTON],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(
    world.fake.connectionStatus.message.en,
    'Unknown station: Nowhere, 0000000. Use "Find stations" to get its id.',
  );
});

test('the station list is kept in /data: a restart does not download it again', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  await world.app.stop();
  const again = await createWorld({ config: { stations: BOSTON }, dataDir: world.dataDir });
  t.after(() => again.app.stop());
  assert.ok(!again.api.requests.some((url) => url.pathname.endsWith('/stations.json')));
  assert.ok(!again.api.requests.some((url) => url.searchParams.get('interval') === 'hilo'));
  assert.deepEqual(
    again.monitor.followed.map((station) => station.id),
    [BOSTON],
  );
});

test('the next tide scene action, and a station that is not followed', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON, language: 'de' } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  const ack = await world.fake.sceneAction('get_next_tide', {
    station: device.external_id,
    tide: 'low',
  });
  assert.equal(ack.data.outputs.tide, 'low');
  assert.equal(ack.data.outputs.minutes, 661);
  assert.equal(ack.data.outputs.trend, 'rising');
  assert.match(ack.data.outputs.summary, /^Niedrigwasser um 16:31 \(0,04 m\)$/);
  const other = await world.fake.sceneAction('get_next_tide', {
    station: 'ext:x:station:1',
    tide: 'any',
  });
  assert.equal(other.success, false);
});

test('START is the recording time the expectations are written for', () => {
  assert.equal(new Date(START).toISOString(), '2026-10-24T09:30:00.000Z');
});
