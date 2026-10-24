// -----------------------------------------------------------------------------
// The "Find stations" configuration action: lists NOAA stations with their id,
// state, distance and kind, so the user can copy their ids into the
// configuration.
//
// What can be typed:
//   - nothing: the stations nearest to the house (its location in Gladys);
//   - a latitude and a longitude ("37.8, -122.47"): the stations nearest to
//     that point;
//   - a station id (9414290) or a tidesandcurrents.noaa.gov page;
//   - words: matched against the station name and state ("Boston", "Sausalito
//     CA"), case and accents ignored, nearest to the house first.
//
// The search runs on the station list (downloaded once a week): the house
// coordinates never leave Gladys and the container.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseToken } from './config.js';
import { distanceKm } from './geo.js';
import { SEARCH, formatNumber, render } from './messages.js';
import { Monitor } from './monitor.js';

const logger = createLogger({ name: 'noaa-tides-search' });

const MAX_RESULTS = 10;
const NEAREST = 8;
const POINT = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const located = (station) => station.latitude !== null && station.longitude !== null;
const distanceTo = (point, station) =>
  point && located(station)
    ? distanceKm(point.latitude, point.longitude, station.latitude, station.longitude)
    : null;

/** The stations nearest to a point. */
function nearest(stations, point) {
  return stations
    .filter(located)
    .map((station) => ({ station, km: distanceTo(point, station) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, NEAREST);
}

async function candidates(monitor, query, stations) {
  const point = POINT.exec(query);
  if (point) {
    const latitude = Number(point[1]);
    const longitude = Number(point[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { list: nearest(stations, { latitude, longitude }) };
    }
  }
  const house = await monitor.house();
  if (!query) {
    return house ? { list: nearest(stations, house) } : { error: 'noHouse' };
  }
  const token = parseToken(query);
  let found = token.kind === 'id' ? stations.filter((station) => station.id === token.value) : [];
  if (found.length === 0) {
    const words = query.split(/[\s,]+/).filter(Boolean);
    found = stations.filter((station) => Monitor.matches(station, words));
  }
  const list = found.map((station) => ({ station, km: distanceTo(house, station) }));
  list.sort(
    (a, b) =>
      (a.km === null) - (b.km === null) ||
      (a.km ?? 0) - (b.km ?? 0) ||
      b.station.reference - a.station.reference ||
      a.station.name.localeCompare(b.station.name),
  );
  return { list };
}

/**
 * Handler of the `search_stations` action.
 * @param {Monitor} monitor
 * @param {{ query?: string }} fields
 */
export async function searchStations(monitor, fields = {}) {
  try {
    const stations = await monitor.stationList();
    if (!stations) {
      return render(SEARCH, 'unavailable');
    }
    const found = await candidates(monitor, String(fields.query ?? '').trim(), stations);
    if (found.error) {
      return render(SEARCH, found.error);
    }
    const total = found.list.length;
    const listed = found.list.slice(0, MAX_RESULTS);
    logger.info(`Station search: ${total} station(s) found`);
    if (listed.length === 0) {
      return render(SEARCH, 'none');
    }
    return Object.fromEntries(
      Object.keys(SEARCH).map((language) => {
        const texts = SEARCH[language];
        const lines = listed.map(({ station, km }) => {
          const parts = [
            `${station.id} — ${station.name}${station.state ? `, ${station.state}` : ''}`,
          ];
          if (km !== null) {
            parts.push(`${formatNumber(km, language, km < 10 ? 1 : 0)} km`);
          }
          parts.push(station.reference ? texts.reference : texts.subordinate);
          return parts.join(' · ');
        });
        const head = texts.found.replace('{count}', listed.length).replace('{total}', total);
        return [language, `${head}\n${lines.join('\n')}`];
      }),
    );
  } catch (err) {
    logger.warn(`Station search failed: ${err.message}`);
    return render(SEARCH, 'unavailable');
  }
}
