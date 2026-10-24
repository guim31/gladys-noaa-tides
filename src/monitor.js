// -----------------------------------------------------------------------------
// The heart of the integration: the followed stations, what NOAA says about
// them, the states published to Gladys and the scene triggers.
//
// Followed stations: the "Stations" field (ids or names), resolved on the
// NOAA list of the stations with tide predictions (downloaded once a week and
// kept in /data).
//
// Requests to NOAA, per followed station:
//   - details (sensors, flood level): once a week;
//   - predictions: the high and low tides from yesterday to the day after
//     tomorrow, and the 6-minute curve of the next 33 hours (reference
//     stations): every 6 hours;
//   - latest water level and water temperature, for the created devices whose
//     station measures them: every 6 minutes (the CO-OPS sampling interval).
// A failed request is tried again 15 minutes later; the predictions already
// known cover the next two days, so an outage of NOAA hides nothing at first.
//
// Every minute (should_poll: false, the container's own timer): the states of
// the created devices (only the changed ones, plus a heartbeat every 12 h), and
// the scene events whose instant fell in the minute.
//
// Calm logs: nothing at info for a normal cycle; a failure that repeats is one
// line, plus one when it is over. The coordinates of the house are never logged.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MAX_STATIONS, normalizeName } from './config.js';
import { FEATURE_KEYS, buildDevice, deviceName, stationIdOf, stationIds } from './devices.js';
import {
  STATUS,
  formatHeight,
  formatTime,
  fromUnit,
  heightUnit,
  render,
  sentence,
  tideName,
  tideSentence,
  toTemperature,
  toUnit,
  trendName,
} from './messages.js';
import { NoaaClient, isNoData } from './noaa.js';
import { HOUR, MINUTE, TIDE_TYPES, levelAt, minutesBetween, nextTide, trendAt } from './tides.js';

const logger = createLogger({ name: 'noaa-tides' });

export const TRIGGERS = { TIDE_UPCOMING: 'tide_upcoming', HIGH_TIDE_ABOVE: 'high_tide_above' };
export const TIDE_CHOICES = Object.values(TIDE_TYPES);
// Minutes before the tide (0 = at the time of the tide), one event per choice:
// the scene filters compare by equality only.
export const TIDE_OFFSETS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 360];
export const ABOVE_OFFSETS = [0, 30, 60, 120, 180, 360, 720, 1440];
export const WIDGET_KEY = 'next_tides';

const DAY = 24 * HOUR;
export const DEFAULT_TIMINGS = {
  tickMs: MINUTE,
  listMaxAgeMs: 7 * DAY,
  detailsMaxAgeMs: 7 * DAY,
  predictionsMaxAgeMs: 6 * HOUR,
  observationsEveryMs: 6 * MINUTE,
  retryMs: 15 * MINUTE,
  noDataRetryMs: 6 * HOUR,
  levelFreshMs: HOUR,
  temperatureFreshMs: 3 * HOUR,
  heartbeatMs: 12 * HOUR,
  // A tick later than this after the previous one (container stopped) fires
  // nothing for the missed minutes: a stale "high tide in 30 min" is noise.
  catchUpMs: 15 * MINUTE,
};
// Predictions asked: high and low tides from 26 h ago for 96 h (the trigger
// "24 h before" needs a day ahead at all times), the curve from 3 h ago for 36 h.
const HILO_BACK_MS = 26 * HOUR;
const HILO_HOURS = 96;
const CURVE_BACK_MS = 3 * HOUR;
const CURVE_HOURS = 36;
// Predictions must still reach this far ahead, else they are asked again.
const AHEAD_MS = 30 * HOUR;
const MAX_STRING = 1000;

const text = (value) => String(value ?? '').slice(0, MAX_STRING);

export class Monitor {
  constructor({ gladys, store, fetch, timers = true, now = Date.now, timings = {} }) {
    this.gladys = gladys;
    // Three files under /data, written only when their content changes: the
    // station list (about 400 KB, weekly), what is known of the followed
    // stations, and the few bytes of the last trigger check (every minute).
    this.store = store;
    this.listStore = store.sibling('noaa-tides-list.json');
    this.tickStore = store.sibling('noaa-tides-tick.json');
    this.dirty = false;
    this.started = false;
    this.pendingDiscover = false;
    this.pendingRun = null;
    this.api = new NoaaClient({ fetch });
    this.timers = timers;
    this.now = now;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.data = { list: null, listAt: 0, stations: {}, lastTick: null };
    this.followed = [];
    this.unknown = [];
    this.warnedUnknown = new Set();
    this.nextAttempt = new Map();
    this.failures = new Set();
    this.devices = new Map();
    this.timer = null;
    this.cycling = null;
    this.stopped = false;
    this.lastWidgetRefresh = 0;
  }

  // --- Lifecycle -----------------------------------------------------------------

  async start(config) {
    this.config = config;
    const [saved, list, tick] = await Promise.all([
      this.store.load(),
      this.listStore.load(),
      this.tickStore.load(),
    ]);
    if (Array.isArray(list.list)) {
      this.data.list = list.list;
      this.data.listAt = Number(list.listAt) || 0;
    }
    if (saved.stations && typeof saved.stations === 'object') {
      this.data.stations = saved.stations;
    }
    this.data.lastTick = Number(tick.lastTick) || null;
    this.started = true;
    this.resolve();
    await this.loadDevices();
    this.running = this.runCycle({ discover: true });
    await this.running;
    logger.info(
      `Started: ${this.followed.length} station(s) followed, ${config.imperial ? 'feet and °F' : 'metres and °C'}`,
    );
    if (this.timers) {
      this.timer = setInterval(() => {
        this.runCycle().catch((err) => logger.error('Refresh cycle failed', err));
      }, this.timings.tickMs);
      this.timer.unref?.();
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Waits for the cycle in progress and the last writes under /data.
    return (this.cycling ?? Promise.resolve()).then(() =>
      Promise.all([this.store.flush(), this.listStore.flush(), this.tickStore.flush()]),
    );
  }

  /** New configuration: the stations, units or alert levels may have changed. */
  async reconfigure(config) {
    if (!this.started) {
      // The first start failed (configuration unreadable): start now.
      await this.start(config);
      return;
    }
    this.config = config;
    this.resolve();
    await this.runCycle({ discover: true });
    this.refreshWidget(true);
    logger.info(`Configuration updated: ${this.followed.length} station(s) followed`);
  }

  /** Gladys reconnected (restarted): publish everything again. */
  async resync(config) {
    if (!this.started) {
      await this.start(config);
      return;
    }
    this.config = config;
    this.resolve();
    await this.loadDevices();
    this.gladys.forgetPublishedStates?.();
    await this.runCycle({ discover: true });
    this.refreshWidget(true);
  }

  async loadDevices() {
    try {
      const devices = await this.gladys.getDevices();
      this.devices = new Map();
      for (const device of devices ?? []) {
        const id = stationIdOf(this.gladys, device.external_id);
        if (id) {
          this.devices.set(id, device);
        }
      }
      this.recovered('devices', 'The devices of Gladys are read again');
    } catch (err) {
      this.failed('devices', `Cannot read the devices of Gladys: ${err.message}`);
    }
  }

  async onDeviceCreated() {
    await this.loadDevices();
    // Observations of a new device are asked at once.
    for (const id of this.devices.keys()) {
      this.nextAttempt.delete(`obs:${id}`);
    }
    await this.runCycle();
    this.refreshWidget(true);
  }

  async onDeviceDeleted() {
    await this.loadDevices();
    this.refreshWidget(true);
  }

  /** onPoll fallback (devices are published with should_poll: false). */
  async poll() {
    await this.runCycle();
  }

  // --- Stations --------------------------------------------------------------------

  /** Resolve the tokens of the "Stations" field on the station list. */
  resolve() {
    this.followed = [];
    this.unknown = [];
    if (!this.config || !this.data.list) {
      return;
    }
    const byId = new Map(this.data.list.map((station) => [station.id, station]));
    const seen = new Set();
    for (const token of this.config.stations) {
      const station =
        token.kind === 'id'
          ? byId.get(token.value)
          : Monitor.findByName(this.data.list, token.value);
      if (!station) {
        this.unknown.push(token.text);
        if (!this.warnedUnknown.has(token.text)) {
          this.warnedUnknown.add(token.text);
          logger.warn(`Unknown station: ${token.text}`);
        }
        continue;
      }
      if (!seen.has(station.id) && this.followed.length < MAX_STATIONS) {
        seen.add(station.id);
        this.followed.push(station);
      }
    }
  }

  /** Whether a station matches every word typed (case and accents ignored). */
  static matches(station, words) {
    const name = ` ${normalizeName(`${station.name} ${station.state}`)} `;
    return words.every((word) => name.includes(normalizeName(word)));
  }

  /**
   * The station a name designates: every word must match; reference stations
   * first (they have the full curve), then the shortest name ("Boston" before
   * "Boston Light").
   */
  static findByName(list, name) {
    const words = normalizeName(name).split(' ').filter(Boolean);
    if (words.length === 0) {
      return null;
    }
    const found = list.filter((station) => Monitor.matches(station, words));
    found.sort(
      (a, b) =>
        (normalizeName(b.name) === words.join(' ')) - (normalizeName(a.name) === words.join(' ')) ||
        b.reference - a.reference ||
        a.name.length - b.name.length,
    );
    return found[0] ?? null;
  }

  /** The station list, downloaded when missing (for the search action). */
  async stationList() {
    if (!this.data.list && (await this.refreshList(this.now(), { force: true }))) {
      // Downloaded here: the next cycle resolves the configured stations.
      this.pendingDiscover = true;
    }
    return this.data.list;
  }

  /** The first house of Gladys that has a location, or null. */
  async house() {
    try {
      const houses = await this.gladys.getHouses();
      return (
        (houses ?? []).find(
          (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
        ) ?? null
      );
    } catch (err) {
      logger.warn(`Cannot read the houses of Gladys: ${err.message}`);
      return null;
    }
  }

  station(id) {
    return this.followed.find((station) => station.id === id) ?? null;
  }

  isCreated(id) {
    return this.devices.has(id);
  }

  /** The followed stations whose device exists in Gladys, in configuration order. */
  created() {
    return this.followed.filter((station) => this.devices.has(station.id));
  }

  // --- Requests to NOAA --------------------------------------------------------------

  due(key, now) {
    return (this.nextAttempt.get(key) ?? 0) <= now;
  }

  /**
   * Runs a request; a failure is tried again later. After a network failure
   * the rest of the cycle asks nothing (NOAA is down: no pile of timeouts). A
   * "no data" answer of a station is not an outage: it is warned once per
   * station and asked again every 6 hours.
   */
  async attempt(key, now, request, { force = false } = {}) {
    if (this.outage && !force) {
      this.nextAttempt.set(key, now + this.timings.retryMs);
      return { ok: false };
    }
    this.attempts += 1;
    try {
      const result = await request();
      this.nextAttempt.delete(key);
      this.recoveredNoData(key);
      return { ok: true, result };
    } catch (err) {
      if (isNoData(err)) {
        this.nextAttempt.set(key, now + this.timings.noDataRetryMs);
        this.failedNoData(key, err);
      } else {
        this.nextAttempt.set(key, now + this.timings.retryMs);
        this.outage = err;
      }
      return { ok: false, error: err };
    }
  }

  failedNoData(key, err) {
    const id = key.split(':')[1];
    if (id && !this.failures.has(`nodata:${id}`)) {
      this.failures.add(`nodata:${id}`);
      logger.warn(`Station ${id}: NOAA has no data for it (${err.apiMessage})`);
    }
  }

  recoveredNoData(key) {
    const id = key.split(':')[1];
    if (id && key.startsWith('predictions:')) {
      this.recovered(`nodata:${id}`, `Station ${id}: NOAA has data for it again`);
    }
  }

  async refreshList(now, { force = false } = {}) {
    const stale = !this.data.list || now - this.data.listAt > this.timings.listMaxAgeMs;
    if (!stale || (!force && !this.due('list', now))) {
      return false;
    }
    // A user action (force) asks even after a failure of the last cycle.
    const { ok, result } = await this.attempt('list', now, () => this.api.stations(), { force });
    if (!ok) {
      return false;
    }
    this.data.list = result;
    this.data.listAt = now;
    this.listStore.save({ list: result, listAt: now });
    logger.debug(`Station list: ${result.length} stations`);
    return true;
  }

  async refreshStation(station, now) {
    const entry = (this.data.stations[station.id] ??= {});
    let structure = false;
    if (
      (!entry.details || now - entry.detailsAt > this.timings.detailsMaxAgeMs) &&
      this.due(`details:${station.id}`, now)
    ) {
      const { ok, result } = await this.attempt(`details:${station.id}`, now, () =>
        this.api.details(station.id),
      );
      if (ok) {
        const before = entry.details;
        entry.details = result;
        entry.detailsAt = now;
        this.dirty = true;
        // The sensors decide the features: a change is a new device structure.
        structure =
          before?.waterLevel !== result.waterLevel ||
          before?.waterTemperature !== result.waterTemperature;
      }
    }
    const lastExtreme = entry.extremes?.at(-1)?.at ?? 0;
    if (
      (!entry.extremes ||
        now - entry.predictionsAt > this.timings.predictionsMaxAgeMs ||
        lastExtreme < now + AHEAD_MS) &&
      this.due(`predictions:${station.id}`, now)
    ) {
      const { ok, result } = await this.attempt(`predictions:${station.id}`, now, async () => {
        const extremes = await this.api.extremes(station.id, now - HILO_BACK_MS, HILO_HOURS);
        const curve = station.reference
          ? await this.api.curve(station.id, now - CURVE_BACK_MS, CURVE_HOURS)
          : [];
        return { extremes, curve };
      });
      if (ok && result.extremes.length > 0) {
        entry.extremes = result.extremes;
        entry.curve = result.curve;
        entry.predictionsAt = now;
        this.dirty = true;
        this.refreshWidget();
      } else if (ok) {
        // An empty answer: asked again later, not at every minute.
        this.nextAttempt.set(`predictions:${station.id}`, now + this.timings.retryMs);
      }
    }
    const details = entry.details;
    if (
      this.isCreated(station.id) &&
      (details?.waterLevel || details?.waterTemperature) &&
      this.due(`obs:${station.id}`, now)
    ) {
      const { ok, result } = await this.attempt(`obs:${station.id}`, now, async () => ({
        level: details.waterLevel ? await this.api.latest(station.id, 'water_level') : null,
        temperature: details.waterTemperature
          ? await this.api.latest(station.id, 'water_temperature')
          : null,
      }));
      if (ok) {
        this.dirty = true;
        entry.level = result.level ?? entry.level ?? null;
        entry.temperature = result.temperature ?? entry.temperature ?? null;
        this.nextAttempt.set(`obs:${station.id}`, now + this.timings.observationsEveryMs);
      }
    }
    return structure;
  }

  // --- The cycle ------------------------------------------------------------------------

  /** One refresh: data due, states, scene events. Cycles never overlap. */
  runCycle(options = {}) {
    if (this.cycling) {
      // One run waits for the one in progress (a device created mid-cycle
      // gets its states at once); several requests share it.
      if (options.discover) {
        this.pendingDiscover = true;
      }
      this.pendingRun ??= this.cycling.then(() => {
        this.pendingRun = null;
        return this.runCycle();
      });
      return this.pendingRun;
    }
    this.cycling = this.cycle(options).finally(() => {
      this.cycling = null;
    });
    return this.cycling;
  }

  async cycle({ discover = false } = {}) {
    if (this.stopped || !this.config) {
      return;
    }
    const now = this.now();
    // The scene events of the minute come from the predictions already
    // known: a slow NOAA never delays them.
    await this.fireEvents(now);
    this.outage = null;
    this.attempts = 0;
    let structure = discover || this.pendingDiscover;
    if (this.pendingDiscover) {
      this.pendingDiscover = false;
      this.resolve();
    }
    if (await this.refreshList(now)) {
      this.resolve();
      structure = true;
    }
    for (const station of this.followed) {
      if (await this.refreshStation(station, now)) {
        structure = true;
      }
    }
    if (this.outage) {
      if (this.failed('noaa', `NOAA unreachable: ${this.outage.message}`)) {
        await this.status(false, 'unreachable');
      }
    } else if (this.attempts > 0 && this.recovered('noaa', 'NOAA answers again')) {
      // Only a cycle that asked NOAA something and got answers says it is back.
      await this.status(true);
    }
    if (structure) {
      await this.publishDiscovered();
    }
    await this.publishStates(now);
    logger.debug(`Refresh cycle: ${this.followed.length} station(s)`);
    await this.save();
    if (discover && !this.failures.has('noaa')) {
      await this.status(true);
    }
  }

  async status(connected, key) {
    try {
      if (connected && this.unknown.length > 0) {
        await this.gladys.setConnectionStatus(
          true,
          render(STATUS, 'unknown', { names: this.unknown.join(', ') }),
        );
      } else {
        await this.gladys.setConnectionStatus(connected, key ? render(STATUS, key) : undefined);
      }
    } catch (err) {
      logger.debug(`Cannot set the connection status: ${err.message}`);
    }
  }

  save() {
    const writes = [this.tickStore.save({ lastTick: this.data.lastTick })];
    if (this.dirty) {
      this.dirty = false;
      writes.push(this.store.save({ stations: this.data.stations }));
    }
    return Promise.all(writes);
  }

  /** The discovery list: one device per followed station. */
  async publishDiscovered() {
    const devices = this.followed.map((station) =>
      buildDevice(this.gladys, station, this.data.stations[station.id]?.details ?? null, {
        language: this.config.language,
        imperial: this.config.imperial,
      }),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      logger.warn(`Cannot publish the discovered devices: ${err.message}`);
    }
  }

  // --- What is known of a station, now ---------------------------------------------------

  /** The alert level of a station in metres above MLLW, and where it comes from. */
  alertLevel(id) {
    const levels = this.config.alertLevels;
    const typed = levels.byStation[id] ?? levels.all;
    if (typed !== null && typed !== undefined) {
      return { metres: fromUnit(typed, this.config.imperial), source: 'config' };
    }
    const minor = this.data.stations[id]?.details?.minorFlood;
    return Number.isFinite(minor) ? { metres: minor, source: 'noaa' } : null;
  }

  view(id, now = this.now()) {
    const station = this.station(id);
    const entry = this.data.stations[id] ?? {};
    const predictions = { extremes: entry.extremes ?? [], curve: entry.curve ?? [] };
    const fresh = (reading, maxAge) =>
      reading && now - reading.at <= maxAge && reading.at <= now + MINUTE ? reading : null;
    return {
      station,
      details: entry.details ?? null,
      predictions,
      updatedAt: entry.predictionsAt ?? null,
      level: levelAt(predictions, now),
      trend: trendAt(predictions.extremes, now),
      next: nextTide(predictions.extremes, now),
      nextHigh: nextTide(predictions.extremes, now, 'H'),
      nextLow: nextTide(predictions.extremes, now, 'L'),
      observed: fresh(entry.level, this.timings.levelFreshMs),
      temperature: fresh(entry.temperature, this.timings.temperatureFreshMs),
    };
  }

  // --- States ------------------------------------------------------------------------------

  /** The states of a created station, in the units of its features as created. */
  statesOf(id, now) {
    const device = this.devices.get(id);
    const view = this.view(id, now);
    const language = this.config.language;
    const imperial = this.config.imperial;
    const ids = stationIds(this.gladys, id);
    const units = new Map((device?.features ?? []).map((f) => [f.external_id, f.unit]));
    const states = [];
    const height = (key, metres) => {
      if (units.has(ids[key]) && metres !== null && metres !== undefined) {
        states.push({
          device_feature_external_id: ids[key],
          state: toUnit(metres, units.get(ids[key]) === 'feet'),
        });
      }
    };
    const number = (key, value) => {
      if (units.has(ids[key]) && value !== null) {
        states.push({ device_feature_external_id: ids[key], state: value });
      }
    };
    const words = (key, value) => {
      if (units.has(ids[key]) && value) {
        states.push({ device_feature_external_id: ids[key], text: value });
      }
    };
    height(FEATURE_KEYS.LEVEL, view.level);
    words(FEATURE_KEYS.TREND, view.trend ? trendName(view.trend, language) : null);
    words(FEATURE_KEYS.NEXT_TIDE, tideSentence(view.next, language, imperial));
    number(FEATURE_KEYS.NEXT_HIGH_IN, view.nextHigh ? minutesBetween(now, view.nextHigh.at) : null);
    height(FEATURE_KEYS.NEXT_HIGH_HEIGHT, view.nextHigh?.height);
    number(FEATURE_KEYS.NEXT_LOW_IN, view.nextLow ? minutesBetween(now, view.nextLow.at) : null);
    height(FEATURE_KEYS.NEXT_LOW_HEIGHT, view.nextLow?.height);
    height(FEATURE_KEYS.OBSERVED_LEVEL, view.observed?.value);
    if (view.temperature && units.has(ids.water_temperature)) {
      states.push({
        device_feature_external_id: ids.water_temperature,
        state: toTemperature(
          view.temperature.value,
          units.get(ids.water_temperature) === 'fahrenheit',
        ),
      });
    }
    return states;
  }

  async publishStates(now) {
    const states = this.created().flatMap((station) => this.statesOf(station.id, now));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      this.failed('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  // --- Scene events ---------------------------------------------------------------------------

  /** The data shared by every event and by the scene action, for one tide. */
  tideData(station, tide, language) {
    const imperial = this.config.imperial;
    return {
      station: stationIds(this.gladys, station.id).device,
      station_name: text(deviceName(station, language)),
      tide: TIDE_TYPES[tide.type],
      tide_time: formatTime(tide.at, language),
      tide_datetime: new Date(tide.at).toISOString(),
      height: toUnit(tide.height, imperial),
      unit: heightUnit(imperial),
    };
  }

  /** Every scene event of a station whose instant is in (from, to]. */
  eventsBetween(station, from, to) {
    const language = this.config.language;
    const imperial = this.config.imperial;
    const extremes = this.data.stations[station.id]?.extremes ?? [];
    const alert = this.alertLevel(station.id);
    const events = [];
    const inWindow = (at) => at > from && at <= to;
    for (const tide of extremes) {
      const base = this.tideData(station, tide, language);
      const values = (offset) => ({
        tide: tideName(tide.type, language),
        station: station.name,
        minutes: offset,
        time: base.tide_time,
        height: formatHeight(tide.height, language, imperial),
        level: alert ? formatHeight(alert.metres, language, imperial) : '',
      });
      for (const offset of TIDE_OFFSETS) {
        if (inWindow(tide.at - offset * MINUTE)) {
          events.push({
            key: TRIGGERS.TIDE_UPCOMING,
            at: tide.at - offset * MINUTE,
            data: {
              ...base,
              minutes_before: String(offset),
              summary: text(
                sentence(offset === 0 ? 'tideNow' : 'tideIn', language, values(offset)),
              ),
            },
          });
        }
      }
      if (tide.type !== 'H' || !alert || tide.height < alert.metres) {
        continue;
      }
      for (const offset of ABOVE_OFFSETS) {
        if (inWindow(tide.at - offset * MINUTE)) {
          const { tide: _tide, ...rest } = base;
          events.push({
            key: TRIGGERS.HIGH_TIDE_ABOVE,
            at: tide.at - offset * MINUTE,
            data: {
              ...rest,
              minutes_before: String(offset),
              alert_level: toUnit(alert.metres, imperial),
              summary: text(
                sentence(offset === 0 ? 'aboveNow' : 'aboveIn', language, values(offset)),
              ),
            },
          });
        }
      }
    }
    return events;
  }

  async fireEvents(now) {
    const last = this.data.lastTick;
    const from = last !== null && now - last <= this.timings.catchUpMs && last < now ? last : now;
    if (from < now) {
      const events = this.created()
        .flatMap((station) => this.eventsBetween(station, from, now))
        .sort((a, b) => a.at - b.at);
      for (const event of events) {
        try {
          await this.gladys.publishSceneEvent(event.key, event.data);
          logger.debug(`Scene event ${event.key}: ${event.data.summary}`);
        } catch (err) {
          logger.warn(`Cannot send the scene event ${event.key}: ${err.message}`);
        }
      }
    }
    if (last === null || now > last) {
      this.data.lastTick = now;
    }
  }

  // --- Scene action ------------------------------------------------------------------------------

  /** Outputs of the `get_next_tide` scene action. */
  nextTideOutputs(externalId, type) {
    const id = stationIdOf(this.gladys, externalId);
    const station = id ? this.station(id) : null;
    if (!station) {
      throw new Error('This station is not followed by the NOAA Tides integration');
    }
    const now = this.now();
    const view = this.view(id, now);
    const wanted = type === 'high' ? 'H' : type === 'low' ? 'L' : null;
    const tide = nextTide(view.predictions.extremes, now, wanted);
    if (!tide) {
      throw new Error(`No tide prediction known yet for ${station.name}`);
    }
    const language = this.config.language;
    const imperial = this.config.imperial;
    const base = this.tideData(station, tide, language);
    return {
      tide: base.tide,
      tide_time: base.tide_time,
      tide_datetime: base.tide_datetime,
      height: base.height,
      unit: base.unit,
      minutes: minutesBetween(now, tide.at),
      level_now: view.level === null ? -1 : toUnit(view.level, imperial),
      trend: view.trend ?? '',
      summary: text(tideSentence(tide, language, imperial)),
    };
  }

  // --- Widget, logs ----------------------------------------------------------------------------

  /** Nudges the dashboards; at most every 10 s (the core drops the others). */
  refreshWidget(force = false) {
    const now = this.now();
    if (this.stopped || (!force && now - this.lastWidgetRefresh < 10000)) {
      return;
    }
    this.lastWidgetRefresh = now;
    try {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh: ${err.message}`);
    }
  }

  /** Logs a failure once; true the first time. */
  failed(key, message) {
    if (this.failures.has(key)) {
      logger.debug(message);
      return false;
    }
    this.failures.add(key);
    logger.warn(message);
    return true;
  }

  /** Logs the end of a failure; true when there was one. */
  recovered(key, message) {
    if (!this.failures.delete(key)) {
      return false;
    }
    logger.info(message);
    return true;
  }
}
