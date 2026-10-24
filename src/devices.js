// -----------------------------------------------------------------------------
// The Gladys devices: one per followed NOAA station, named "Tide <station>"
// ("Marée Boston").
//
// Features (couples checked against the Gladys front, v5.2, see
// test/gladys-rules.test.js):
//   - level              level-sensor/liquid-depth: predicted level now
//   - trend              text: rising / falling
//   - next_tide          text: "High tide at 5:39 PM (1.80 m)"
//   - next_high_in       duration/integer, minutes to the next high tide
//   - next_high_height   level-sensor/liquid-depth
//   - next_low_in        duration/integer, minutes to the next low tide
//   - next_low_height    level-sensor/liquid-depth
//   - observed_level     level-sensor/liquid-depth: water level measured by
//                        the station (only stations with an active sensor)
//   - water_temperature  temperature-sensor/decimal (idem)
// Heights are above MLLW, in metres or feet (configuration), temperatures in
// °C or °F. The states follow the unit of the feature as created in Gladys
// (src/monitor.js), so changing the units never mixes them up.
//
// Published with should_poll: false: the container refreshes the states every
// minute itself (src/monitor.js). The platform id is the NOAA station id
// (9414290), stable for the life of the station: never a name.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { FEET_PER_METRE, sentence } from './messages.js';

export const DEVICE_TYPE = 'station';
export const FEATURE_KEYS = {
  LEVEL: 'level',
  TREND: 'trend',
  NEXT_TIDE: 'next_tide',
  NEXT_HIGH_IN: 'next_high_in',
  NEXT_HIGH_HEIGHT: 'next_high_height',
  NEXT_LOW_IN: 'next_low_in',
  NEXT_LOW_HEIGHT: 'next_low_height',
  OBSERVED_LEVEL: 'observed_level',
  WATER_TEMPERATURE: 'water_temperature',
};

// Display bounds, in metres above MLLW: the lowest predicted tides of the US
// are about -1.5 m (Alaska), the highest about +11 m (Cook Inlet).
const HEIGHT_METRES = [-5, 15];
// A tide comes back every 12 h 25 min; a diurnal station may have one a day.
const MAX_MINUTES = 1500;

export const NAMES = {
  en: {
    level: 'Predicted level',
    trend: 'Tide',
    next_tide: 'Next tide',
    next_high_in: 'Next high tide in',
    next_high_height: 'Next high tide height',
    next_low_in: 'Next low tide in',
    next_low_height: 'Next low tide height',
    observed_level: 'Observed water level',
    water_temperature: 'Water temperature',
  },
  fr: {
    level: 'Hauteur prédite',
    trend: 'Marée',
    next_tide: 'Prochaine marée',
    next_high_in: 'Prochaine pleine mer dans',
    next_high_height: 'Hauteur de la prochaine pleine mer',
    next_low_in: 'Prochaine basse mer dans',
    next_low_height: 'Hauteur de la prochaine basse mer',
    observed_level: "Hauteur d'eau mesurée",
    water_temperature: "Température de l'eau",
  },
  de: {
    level: 'Vorhergesagter Wasserstand',
    trend: 'Gezeit',
    next_tide: 'Nächste Gezeit',
    next_high_in: 'Nächstes Hochwasser in',
    next_high_height: 'Höhe des nächsten Hochwassers',
    next_low_in: 'Nächstes Niedrigwasser in',
    next_low_height: 'Höhe des nächsten Niedrigwassers',
    observed_level: 'Gemessener Wasserstand',
    water_temperature: 'Wassertemperatur',
  },
  es: {
    level: 'Nivel previsto',
    trend: 'Marea',
    next_tide: 'Próxima marea',
    next_high_in: 'Próxima pleamar dentro de',
    next_high_height: 'Altura de la próxima pleamar',
    next_low_in: 'Próxima bajamar dentro de',
    next_low_height: 'Altura de la próxima bajamar',
    observed_level: 'Nivel del agua medido',
    water_temperature: 'Temperatura del agua',
  },
};

/** External ids of a station device and of its features. */
export function stationIds(gladys, id) {
  const ids = gladys.externalIds(DEVICE_TYPE, id);
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

/** The station id of a device or feature external id (null if not a station). */
export function stationIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** The name of a station device: "Marée Boston". */
export const deviceName = (station, language) =>
  sentence('deviceName', language, { station: station.name });

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

/**
 * The discovery payload of a station.
 * @param {object} gladys
 * @param {object} station see src/noaa.js parseStation
 * @param {object|null} details see src/noaa.js parseDetails (null: not known yet)
 * @param {{ language: string, imperial: boolean }} options
 */
export function buildDevice(gladys, station, details, { language = 'fr', imperial = false } = {}) {
  const ids = stationIds(gladys, station.id);
  const names = NAMES[language] ?? NAMES.fr;
  const factor = imperial ? FEET_PER_METRE : 1;
  const height = (key, keepHistory) =>
    sensor(names[key], ids[key], C.LEVEL_SENSOR, TYPES.LEVEL_SENSOR.LIQUID_DEPTH, {
      unit: imperial ? UNITS.FEET : UNITS.M,
      keep_history: keepHistory,
      min: Math.floor(HEIGHT_METRES[0] * factor),
      max: Math.ceil(HEIGHT_METRES[1] * factor),
    });
  const countdown = (key) =>
    sensor(names[key], ids[key], C.DURATION, TYPES.DURATION.INTEGER, {
      unit: UNITS.MINUTES,
      keep_history: false,
      min: 0,
      max: MAX_MINUTES,
    });
  const text = (key) =>
    sensor(names[key], ids[key], C.TEXT, TYPES.TEXT.TEXT, { keep_history: false, min: 0, max: 0 });

  const features = [
    height(FEATURE_KEYS.LEVEL, true),
    text(FEATURE_KEYS.TREND),
    text(FEATURE_KEYS.NEXT_TIDE),
    countdown(FEATURE_KEYS.NEXT_HIGH_IN),
    height(FEATURE_KEYS.NEXT_HIGH_HEIGHT, false),
    countdown(FEATURE_KEYS.NEXT_LOW_IN),
    height(FEATURE_KEYS.NEXT_LOW_HEIGHT, false),
  ];
  if (details?.waterLevel) {
    features.push(height(FEATURE_KEYS.OBSERVED_LEVEL, true));
  }
  if (details?.waterTemperature) {
    features.push(
      sensor(
        names.water_temperature,
        ids.water_temperature,
        C.TEMPERATURE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        {
          unit: imperial ? UNITS.FAHRENHEIT : UNITS.CELSIUS,
          keep_history: true,
          min: imperial ? 25 : -5,
          max: imperial ? 105 : 40,
        },
      ),
    );
  }
  const params = [
    { name: 'STATION_ID', value: station.id },
    { name: 'DATUM', value: 'MLLW' },
  ];
  if (station.state) {
    params.push({ name: 'STATE', value: station.state });
  }
  return {
    name: deviceName(station, language),
    external_id: ids.device,
    model: station.reference
      ? 'NOAA CO-OPS · reference station'
      : 'NOAA CO-OPS · subordinate station',
    should_poll: false,
    params,
    features,
  };
}
