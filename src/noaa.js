// -----------------------------------------------------------------------------
// Client of the NOAA CO-OPS APIs (keyless, public domain data):
//   - metadata API (mdapi): the stations that have tide predictions (about
//     3,500), and the details of one station: its sensors, flood levels and
//     tidal datums, in one request (`expand=sensors,floodlevels,datums`);
//   - data API (datagetter): the high and low tide predictions
//     (`interval=hilo`), the 6-minute predicted curve (`interval=6`, reference
//     stations only), and the latest water level and water temperature.
//
// Everything is asked in metres, °C, GMT and above MLLW (the datum of the US
// nautical charts); the conversion to feet / °F and to local time is done by
// the integration. CO-OPS asks the callers to name their application
// (`application=`): requests carry `gladys-noaa-tides`.
// -----------------------------------------------------------------------------

import { getJson } from './http.js';

export const SITE_URL = 'https://tidesandcurrents.noaa.gov/';
export const API_HOST = 'https://api.tidesandcurrents.noaa.gov';
const DATAGETTER = `${API_HOST}/api/prod/datagetter`;
const MDAPI = `${API_HOST}/mdapi/prod/webapi`;
const APPLICATION = 'gladys-noaa-tides';

/** The page of a station on Tides & Currents. */
export const stationPage = (id) =>
  `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${encodeURIComponent(id)}`;

/** "SAN FRANCISCO (Golden Gate)" -> "San Francisco (Golden Gate)": capitals of the reference stations. */
export function displayName(name) {
  return String(name ?? '')
    .trim()
    .replace(/\b([A-Z])([A-Z]{2,})\b/g, (_, first, rest) => first + rest.toLowerCase());
}

/** "2026-10-24 05:37" (GMT) -> epoch ms. */
export const parseTime = (text) => Date.parse(`${String(text).replace(' ', 'T')}:00Z`);

/** Epoch ms -> "20261024 05:37" (GMT), the `begin_date` format. */
export function formatBegin(at) {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')} ${iso.slice(11, 16)}`;
}

/**
 * Whether an error is CO-OPS saying "this station has no such data" (HTTP 400
 * with a message) rather than an outage.
 */
export const isNoData = (err) =>
  err?.status === 400 && /no data|no predictions|there is no/i.test(err.apiMessage ?? '');

const number = (value) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** One entry of the station list, reduced to what the integration uses. */
export function parseStation(raw) {
  const latitude = number(raw?.lat);
  const longitude = number(raw?.lng);
  return {
    id: String(raw.id),
    name: displayName(raw.name) || String(raw.id),
    state: raw.state ? String(raw.state) : '',
    latitude,
    longitude,
    // R: reference station (harmonic predictions, 6-minute curve);
    // S: subordinate station (high and low tides only, offsets of a reference).
    reference: raw.type !== 'S',
  };
}

/**
 * What the details of a station say: an active water level sensor, an active
 * water temperature sensor, and the NOAA minor flood level converted to MLLW.
 */
export function parseDetails(json) {
  const station = json?.stations?.[0] ?? {};
  const sensors = Array.isArray(station.sensors?.sensors) ? station.sensors.sensors : [];
  const active = (test) => sensors.some((sensor) => sensor.status === 1 && test(sensor.name ?? ''));
  const mllw = number((station.datums?.datums ?? []).find((datum) => datum.name === 'MLLW')?.value);
  const minor = number(station.floodlevels?.nos_minor) ?? number(station.floodlevels?.nws_minor);
  return {
    // The water level is asked above MLLW: a station without that datum
    // answers "There is no MLLW" and gets no observed level.
    waterLevel: mllw !== null && active((name) => /\bWL$|water level/i.test(name)),
    waterTemperature: active((name) => name === 'Water Temperature'),
    // Flood levels are given above the station datum (STND), like the datums.
    minorFlood: minor !== null && mllw !== null ? Math.round((minor - mllw) * 1000) / 1000 : null,
  };
}

/** The high and low tides of a `predictions` answer, by time. */
export function parseExtremes(json) {
  return (json?.predictions ?? [])
    .map((item) => ({ at: parseTime(item.t), height: number(item.v), type: item.type }))
    .filter(
      (tide) =>
        Number.isFinite(tide.at) &&
        tide.height !== null &&
        (tide.type === 'H' || tide.type === 'L'),
    )
    .sort((a, b) => a.at - b.at);
}

/** The points of a 6-minute `predictions` answer, by time. */
export function parseCurve(json) {
  return (json?.predictions ?? [])
    .map((item) => ({ at: parseTime(item.t), height: number(item.v) }))
    .filter((point) => Number.isFinite(point.at) && point.height !== null)
    .sort((a, b) => a.at - b.at);
}

/** The latest observation of a `water_level` / `water_temperature` answer, or null. */
export function parseLatest(json) {
  const item = (json?.data ?? []).at(-1);
  const value = number(item?.v);
  const at = item ? parseTime(item.t) : Number.NaN;
  return value !== null && Number.isFinite(at) ? { at, value } : null;
}

export class NoaaClient {
  constructor({ fetch: fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get(url) {
    return getJson(this.fetch, url, { timeoutMs: this.timeoutMs });
  }

  data(params) {
    const query = new URLSearchParams({
      ...params,
      units: 'metric',
      time_zone: 'gmt',
      format: 'json',
      application: APPLICATION,
    });
    return this.get(`${DATAGETTER}?${query}`);
  }

  /** Every station with tide predictions. */
  async stations() {
    const json = await this.get(`${MDAPI}/stations.json?type=tidepredictions`);
    if (!Array.isArray(json?.stations)) {
      throw new Error('the station list has no stations');
    }
    return json.stations.filter((raw) => raw?.id).map(parseStation);
  }

  /** Sensors and flood level of a station (a subordinate station has none). */
  async details(id) {
    const query = new URLSearchParams({ expand: 'sensors,floodlevels,datums', units: 'metric' });
    return parseDetails(
      await this.get(`${MDAPI}/stations/${encodeURIComponent(id)}.json?${query}`),
    );
  }

  /** High and low tides from `from` for `hours`. */
  async extremes(id, from, hours) {
    const json = await this.data({
      product: 'predictions',
      interval: 'hilo',
      datum: 'MLLW',
      station: id,
      begin_date: formatBegin(from),
      range: String(hours),
    });
    return parseExtremes(json);
  }

  /** The 6-minute curve from `from` for `hours`; empty for a subordinate station. */
  async curve(id, from, hours) {
    try {
      const json = await this.data({
        product: 'predictions',
        interval: '6',
        datum: 'MLLW',
        station: id,
        begin_date: formatBegin(from),
        range: String(hours),
      });
      return parseCurve(json);
    } catch (err) {
      if (isNoData(err)) {
        return [];
      }
      throw err;
    }
  }

  /** Latest water level (m above MLLW) or water temperature (°C); null without data. */
  async latest(id, product) {
    const params = { product, station: id, date: 'latest' };
    if (product === 'water_level') {
      params.datum = 'MLLW';
    }
    try {
      return parseLatest(await this.data(params));
    } catch (err) {
      if (isNoData(err)) {
        return null;
      }
      throw err;
    }
  }
}
