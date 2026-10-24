// -----------------------------------------------------------------------------
// The `next_tides` widget: valid for the core (SDK validator, budget), bound to
// features the device really has, and its empty and "gone" states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { BATTERY, BOSTON, HULL, create, createWorld, tick } from './helpers/world.js';

const get = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet('next_tides', { settings, language });
  assert.equal(ack.success, true);
  return ack.data.content;
};
const ofType = (content, type) => content.components.filter((c) => c.type === type);

for (const language of ['en', 'fr', 'de', 'es']) {
  test(`a station: tiles, curve with its tides, next tides, within the budget (${language})`, async (t) => {
    const world = await createWorld({ config: { stations: `${BATTERY}, ${HULL}` } });
    t.after(() => world.app.stop());
    const device = await create(world, BATTERY);
    const content = await get(world, { station: device.external_id }, language);
    assert.deepEqual(validateWidgetContent(content), []);
    assert.ok(content.components.length <= 8);
    assert.ok(ofType(content, 'text').length <= 2);
    const ids = new Set(device.features.map((feature) => feature.external_id));
    const tiles = ofType(content, 'value');
    assert.equal(tiles.length, 3, 'predicted, observed, water temperature');
    for (const tile of tiles) {
      assert.ok(ids.has(tile.device_feature), tile.device_feature);
    }
    const [chart] = ofType(content, 'chart');
    assert.ok(chart.series[0].points.length > 100 && chart.series[0].points.length <= 300);
    assert.ok(chart.annotations.length >= 3 && chart.annotations.length <= 8);
    assert.ok(
      chart.annotations.every((a) => a.label.length <= 16),
      JSON.stringify(chart.annotations),
    );
    assert.equal(chart.now_marker, true);
    const [status] = ofType(content, 'status');
    assert.equal(status.items.length, 5, 'four tides and the alert level');
    assert.ok(status.items.every((item) => item.value.length <= 40));
    const [button] = ofType(content, 'button');
    assert.equal(
      button.link.url,
      `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${BATTERY}`,
    );
  });
}

test('without a setting: the first created station; a subordinate station has one tile', async (t) => {
  const world = await createWorld({ config: { stations: `${HULL}, ${BOSTON}` } });
  t.after(() => world.app.stop());
  const empty = await get(world);
  assert.match(empty.components[0].text, /No station followed yet/);
  await create(world, HULL);
  assert.ok(world.fake.widgetRefreshes.includes('next_tides'), 'refreshed at creation');
  const content = await get(world);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text, /^Hull/);
  assert.equal(ofType(content, 'value').length, 1);
  assert.equal(ofType(content, 'status')[0].items.length, 4, 'no alert level at Hull');
});

test('a station no longer followed', async (t) => {
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  await world.fake.configUpdated({ stations: HULL });
  await tick(world, 1);
  const content = await get(world, { station: device.external_id });
  assert.equal(content.components[0].text, 'This station is no longer followed.');
});
