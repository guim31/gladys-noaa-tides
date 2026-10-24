// -----------------------------------------------------------------------------
// The "Find stations" action: near the house, near a point, by name, by id.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './helpers/world.js';

const search = async (world, query) => {
  const ack = await world.fake.action('search_stations', query === undefined ? {} : { query });
  assert.equal(ack.success, true);
  return ack.data.message;
};

test('empty: the stations nearest to the house', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const message = await search(world);
  const lines = message.en.split('\n');
  assert.equal(lines[0], '8 station(s) of 8 found:');
  assert.equal(lines[1], '8443970 — Boston, MA · 0.8 km · full curve');
  assert.match(
    message.fr.split('\n')[2],
    /^8443838 — Charlestown.* · 1,5 km · pleines et basses mers seulement$/,
  );
});

test('a point, a name with its state, an id, a page', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.match(
    (await search(world, '37.8, -122.47')).en.split('\n')[1],
    /^9414290 — San Francisco \(Golden Gate\), CA · /,
  );
  assert.match(
    (await search(world, 'sausalito ca')).en,
    /^1 station\(s\) of 1 found:\n9414806 — Sausalito, CA · [\d,]+ km · high and low tides only$/,
  );
  assert.match((await search(world, '8518750')).en, /8518750 — New York \(The Battery\), NY/);
  assert.match(
    (await search(world, 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8518750')).en,
    /8518750 — New York/,
  );
  assert.match((await search(world, 'Atlantis')).en, /^No station found/);
});

test('no house location, NOAA down', async (t) => {
  const world = await createWorld({ houses: [{ id: 'h', name: 'Home', selector: 'home' }] });
  t.after(() => world.app.stop());
  assert.match((await search(world)).en, /^Your house has no location in Gladys/);
  const fresh = await createWorld();
  t.after(() => fresh.app.stop());
  fresh.monitor.data.list = null;
  fresh.api.down = 503;
  fresh.monitor.nextAttempt.clear();
  assert.match((await search(fresh, 'Boston')).en, /cannot be downloaded right now/);
});

test('the list downloaded by a search lets the configured stations be followed', async (t) => {
  const world = await createWorld({ config: { stations: 'Boston' }, connect: false });
  t.after(() => world.app.stop());
  world.api.down = 'network';
  await world.gladys.connect();
  await world.app.ready;
  assert.equal(world.monitor.followed.length, 0);
  world.api.down = false;
  world.monitor.nextAttempt.clear();
  await search(world, 'Boston');
  world.clock.advance(60 * 1000);
  await world.monitor.runCycle();
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Marée Boston'],
  );
});
