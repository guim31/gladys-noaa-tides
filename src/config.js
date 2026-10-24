// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Units of the heights and temperatures: metres and °C, or feet and °F.
export const UNIT_SYSTEMS = ['metric', 'imperial'];

// Upper bound of the followed stations: every station costs a few requests per
// hour to NOAA and up to four states a minute to Gladys (300 per minute at most).
export const MAX_STATIONS = 10;

export const DEFAULT_CONFIG = {
  stations: '',
  units: 'metric',
  alert_levels: '',
  language: 'fr',
};

// A CO-OPS station id: 7 digits (9414290), or letters and digits for the
// Pacific islands (TPT2705).
const STATION_ID = /^[A-Z]{0,4}\d{3,7}$/;
// Pages of tidesandcurrents.noaa.gov name the station: ?id=9414290 or /stationhome.html?id=…
const ID_IN_URL = /[?&]id=([A-Za-z0-9]+)/;

/**
 * What one token of the "Stations" field designates: a station id (also
 * taken from a tidesandcurrents.noaa.gov page) or words of a name.
 */
export function parseToken(token) {
  const text = String(token ?? '').trim();
  const fromUrl = /^https?:\/\//i.test(text) ? ID_IN_URL.exec(text) : null;
  const candidate = (fromUrl ? fromUrl[1] : text).toUpperCase();
  if (STATION_ID.test(candidate)) {
    return { kind: 'id', value: candidate, text };
  }
  return { kind: 'name', value: text, text };
}

/** The tokens of the "Stations" field, duplicates removed. */
export function parseStations(text) {
  const seen = new Set();
  const tokens = [];
  for (const raw of String(text ?? '').split(/[,;\n]+/)) {
    if (!raw.trim()) {
      continue;
    }
    const token = parseToken(raw);
    const key = `${token.kind}:${normalizeName(token.value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
}

/** A name reduced for comparison: case, accents and punctuation ignored. */
export function normalizeName(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A decimal typed by a user: "1.8", "1,8", " 6 ". Null when not a number. */
export function parseDecimal(text) {
  const value = Number(
    String(text ?? '')
      .trim()
      .replace(',', '.'),
  );
  return String(text ?? '').trim() !== '' && Number.isFinite(value) ? value : null;
}

/**
 * The "Alert levels" field: one level for every station ("1.8"), levels per
 * station ("9414290=2.1; 8443970=3.6"), or both (the plain one is the default).
 * Values are in the unit of the configuration. Unreadable entries are ignored.
 * @returns {{ all: number|null, byStation: Record<string, number> }}
 */
export function parseAlertLevels(text) {
  const levels = { all: null, byStation: {} };
  // A comma is a decimal separator in "1,8": entries are separated by ";",
  // new lines, or a comma followed by a space.
  for (const raw of String(text ?? '').split(/[;\n]+|,\s+/)) {
    const entry = raw.trim();
    if (!entry) {
      continue;
    }
    const match = /^([A-Za-z0-9]+)\s*[=:]\s*(.+)$/.exec(entry);
    if (match) {
      const value = parseDecimal(match[2]);
      if (value !== null) {
        levels.byStation[match[1].toUpperCase()] = value;
      }
    } else {
      const value = parseDecimal(entry);
      if (value !== null) {
        levels.all = value;
      }
    }
  }
  return levels;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    stations: parseStations(source.stations),
    imperial: source.units === 'imperial',
    alertLevels: parseAlertLevels(source.alert_levels),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
