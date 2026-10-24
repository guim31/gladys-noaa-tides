// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENE_ACTIONS } from '../src/app.js';
import { DEFAULT_CONFIG, LANGUAGES, UNIT_SYSTEMS } from '../src/config.js';
import { ABOVE_OFFSETS, TIDE_CHOICES, TIDE_OFFSETS, TRIGGERS, WIDGET_KEY } from '../src/monitor.js';
import { WIDGETS } from '../src/widgets.js';
import { BOSTON, create, createWorld, tick } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The handlers the integration actually registers on the SDK.
const { gladys: registered, app } = await createWorld({ connect: false });
await app.stop();
const handlerKeys = (prefix) =>
  Object.keys(registered.handlers)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionValues = (field) => field.options.map((option) => option.value);
const field = (list, key) => list.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

test('identity: name, image, cover, cloud transport, environment category', () => {
  assert.equal(manifest.name, 'NOAA Tides');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-noaa-tides:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-noaa-tides/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['environment']);
  assert.equal(manifest.location, true, '"Find stations" reads the house location');
});

test('Gladys 5.1.0 at least: widgets, scene triggers and actions', () => {
  const [major, minor] = minGladysVersion();
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), handlerKeys('action:').sort());
});

test('every scene action has a handler, and its outputs are the declared ones', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions), Object.values(SCENE_ACTIONS));
  assert.deepEqual(handlerKeys('sceneAction:'), Object.values(SCENE_ACTIONS));
  const world = await createWorld({ config: { stations: BOSTON } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  const action = field(manifest.scene_actions, SCENE_ACTIONS.GET_NEXT_TIDE);
  assert.deepEqual(optionValues(field(action.fields, 'tide')), ['any', ...TIDE_CHOICES]);
  for (const tide of optionValues(field(action.fields, 'tide'))) {
    const ack = await world.fake.sceneAction(SCENE_ACTIONS.GET_NEXT_TIDE, {
      station: device.external_id,
      tide,
    });
    assert.equal(ack.success, true, tide);
    assert.deepEqual(Object.keys(ack.data.outputs).sort(), keysOf(action.outputs).sort());
    for (const output of action.outputs) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, output.key);
    }
  }
});

test('the scene triggers the monitor fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGERS));
  // An alert level every high tide reaches, so both triggers fire.
  const world = await createWorld({ config: { stations: BOSTON, alert_levels: '0.5' } });
  t.after(() => world.app.stop());
  const device = await create(world, BOSTON);
  for (let i = 0; i < 24 * 60; i += 1) {
    await tick(world, 1);
  }
  const fired = new Set(world.fake.sceneEvents.map((event) => event.key));
  assert.deepEqual([...fired].sort(), Object.values(TRIGGERS).sort());
  for (const event of world.fake.sceneEvents) {
    const trigger = field(manifest.scene_triggers, event.key);
    const declared = [...new Set([...keysOf(trigger.fields), ...keysOf(trigger.variables)])];
    assert.deepEqual(Object.keys(event.data).sort(), declared.sort(), `${event.key}: same keys`);
    assert.equal(event.data.station, device.external_id, 'the station filter is the device');
    for (const entry of trigger.fields.filter((f) => f.options)) {
      assert.ok(
        optionValues(entry).includes(event.data[entry.key]),
        `${event.key}.${entry.key}: ${event.data[entry.key]} is an option`,
      );
    }
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, variable.key);
    }
  }
  const triggers = manifest.scene_triggers;
  assert.deepEqual(
    optionValues(field(field(triggers, TRIGGERS.TIDE_UPCOMING).fields, 'tide')),
    TIDE_CHOICES,
  );
  assert.deepEqual(
    optionValues(field(field(triggers, TRIGGERS.TIDE_UPCOMING).fields, 'minutes_before')),
    TIDE_OFFSETS.map(String),
  );
  assert.deepEqual(
    optionValues(field(field(triggers, TRIGGERS.HIGH_TIDE_ABOVE).fields, 'minutes_before')),
    ABOVE_OFFSETS.map(String),
  );
});

test('every widget has its handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.deepEqual(handlerKeys('widget:'), [WIDGET_KEY]);
});

test('config_schema defaults and options are the ones of the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, entry.key);
    }
  }
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((entry) => entry.type !== 'section')
      .map((entry) => entry.key)
      .sort(),
  );
  assert.deepEqual(optionValues(field(manifest.config_schema, 'language')), LANGUAGES);
  assert.deepEqual(optionValues(field(manifest.config_schema, 'units')), UNIT_SYSTEMS);
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  const dynamic = allFields.filter((entry) => entry.source !== undefined);
  assert.equal(dynamic.length, 4);
  for (const entry of dynamic) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined, entry.key);
  }
});

test('actions: no secret field, no default, no required field (the core applies no default)', () => {
  // GladysAssistant/Gladys#3154 and #3155.
  for (const action of manifest.actions) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret', `${action.key}.${entry.key}`);
      assert.equal(entry.default, undefined, `${action.key}.${entry.key}`);
      assert.notEqual(entry.required, true, `${action.key}.${entry.key}`);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
