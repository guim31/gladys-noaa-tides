// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface (German says "du", Spanish "usted"), and the formatting of
// heights, temperatures and times. Times are shown in the timezone of Gladys
// (TZ, injected by the supervisor), whatever the timezone of the station.
// -----------------------------------------------------------------------------

export const FEET_PER_METRE = 3.28084;

const LOCALES = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const localeOf = (language) => LOCALES[language] ?? LOCALES.en;
// "5:39 PM" in English, "07:13" elsewhere.
const hourOf = (language) => (localeOf(language) === LOCALES.en ? 'numeric' : '2-digit');

export const TIDE_NAMES = {
  en: { H: 'High tide', L: 'Low tide' },
  fr: { H: 'Pleine mer', L: 'Basse mer' },
  de: { H: 'Hochwasser', L: 'Niedrigwasser' },
  es: { H: 'Pleamar', L: 'Bajamar' },
};

export const TREND_NAMES = {
  en: { rising: 'Rising', falling: 'Falling' },
  fr: { rising: 'Montante', falling: 'Descendante' },
  de: { rising: 'Steigend', falling: 'Fallend' },
  es: { rising: 'Subiendo', falling: 'Bajando' },
};

// Sentences; `{name}` placeholders are filled by render().
export const SENTENCES = {
  en: {
    deviceName: 'Tide {station}',
    tideAt: '{tide} at {time} ({height})',
    tideIn: '{tide} in {minutes} min at {station}: {time}, {height}',
    tideNow: '{tide} now at {station}: {height}',
    aboveIn: 'High tide of {height} (alert level {level}) in {minutes} min at {station}, {time}',
    aboveNow: 'High tide of {height} (alert level {level}) now at {station}',
  },
  fr: {
    deviceName: 'Marée {station}',
    tideAt: '{tide} à {time} ({height})',
    tideIn: '{tide} dans {minutes} min à {station} : {time}, {height}',
    tideNow: '{tide} maintenant à {station} : {height}',
    aboveIn: 'Pleine mer de {height} (seuil {level}) dans {minutes} min à {station}, {time}',
    aboveNow: 'Pleine mer de {height} (seuil {level}) maintenant à {station}',
  },
  de: {
    deviceName: 'Gezeiten {station}',
    tideAt: '{tide} um {time} ({height})',
    tideIn: '{tide} in {minutes} Min. in {station}: {time}, {height}',
    tideNow: '{tide} jetzt in {station}: {height}',
    aboveIn: 'Hochwasser von {height} (Warnpegel {level}) in {minutes} Min. in {station}, {time}',
    aboveNow: 'Hochwasser von {height} (Warnpegel {level}) jetzt in {station}',
  },
  es: {
    deviceName: 'Marea {station}',
    tideAt: '{tide} a las {time} ({height})',
    tideIn: '{tide} dentro de {minutes} min en {station}: {time}, {height}',
    tideNow: '{tide} ahora en {station}: {height}',
    aboveIn:
      'Pleamar de {height} (nivel de alerta {level}) dentro de {minutes} min en {station}, {time}',
    aboveNow: 'Pleamar de {height} (nivel de alerta {level}) ahora en {station}',
  },
};

// Connection status shown on the Configuration screen.
export const STATUS = {
  en: {
    initFailed: 'Initialization failed, check the integration logs.',
    unreachable:
      'NOAA Tides & Currents does not answer: the tides will be updated when it is back.',
    unknown: 'Unknown station: {names}. Use "Find stations" to get its id.',
  },
  fr: {
    initFailed: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    unreachable:
      'NOAA Tides & Currents ne répond pas : les marées seront mises à jour à son retour.',
    unknown: 'Station inconnue : {names}. « Chercher des stations » donne son numéro.',
  },
  de: {
    initFailed:
      'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    unreachable:
      'NOAA Tides & Currents antwortet nicht: Die Gezeiten werden aktualisiert, sobald es wieder da ist.',
    unknown: 'Unbekannte Station: {names}. „Stationen suchen“ zeigt ihre Kennung.',
  },
  es: {
    initFailed: 'La inicialización ha fallado, consulte los registros de la integración.',
    unreachable: 'NOAA Tides & Currents no responde: las mareas se actualizarán cuando vuelva.',
    unknown: 'Estación desconocida: {names}. «Buscar estaciones» le da su identificador.',
  },
};

// Answers of the "Find stations" action.
export const SEARCH = {
  en: {
    found: '{count} station(s) of {total} found:',
    none: 'No station found. Type a name ("Boston"), a station id (9414290), latitude and longitude ("37.8, -122.47"), or nothing for the stations near your house.',
    noHouse:
      'Your house has no location in Gladys: type a name, a station id, or latitude and longitude.',
    unavailable:
      'The NOAA station list cannot be downloaded right now: try again in a few minutes.',
    reference: 'full curve',
    subordinate: 'high and low tides only',
  },
  fr: {
    found: '{count} station(s) sur {total} trouvée(s) :',
    none: 'Aucune station trouvée. Tapez un nom (« Boston »), un numéro de station (9414290), une latitude et une longitude (« 37.8, -122.47 »), ou rien pour les stations près de votre maison.',
    noHouse:
      "Votre maison n'a pas de position dans Gladys : tapez un nom, un numéro de station, ou une latitude et une longitude.",
    unavailable:
      'La liste des stations de la NOAA ne peut pas être téléchargée pour le moment : réessayez dans quelques minutes.',
    reference: 'courbe complète',
    subordinate: 'pleines et basses mers seulement',
  },
  de: {
    found: '{count} von {total} Station(en) gefunden:',
    none: 'Keine Station gefunden. Gib einen Namen („Boston“), eine Stationskennung (9414290), Breiten- und Längengrad („37.8, -122.47“) oder nichts für die Stationen nahe deinem Haus ein.',
    noHouse:
      'Dein Haus hat in Gladys keinen Standort: Gib einen Namen, eine Stationskennung oder Breiten- und Längengrad ein.',
    unavailable:
      'Die Stationsliste der NOAA kann gerade nicht geladen werden: Versuche es in ein paar Minuten erneut.',
    reference: 'vollständige Kurve',
    subordinate: 'nur Hoch- und Niedrigwasser',
  },
  es: {
    found: '{count} estación(es) de {total} encontrada(s):',
    none: 'No se ha encontrado ninguna estación. Escriba un nombre («Boston»), un identificador de estación (9414290), una latitud y una longitud («37.8, -122.47»), o nada para las estaciones cerca de su casa.',
    noHouse:
      'Su casa no tiene ubicación en Gladys: escriba un nombre, un identificador de estación, o una latitud y una longitud.',
    unavailable:
      'La lista de estaciones de la NOAA no se puede descargar ahora: inténtelo de nuevo en unos minutos.',
    reference: 'curva completa',
    subordinate: 'solo pleamares y bajamares',
  },
};

const pick = (table, language) => table[language] ?? table.en;

/** Fills the `{name}` placeholders of a text. */
export const fill = (text, values = {}) =>
  text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

/** One entry of a table, in every language: `{ en, fr, de, es }`. */
export const render = (table, key, values) =>
  Object.fromEntries(
    Object.entries(table).map(([language, texts]) => [language, fill(texts[key], values)]),
  );

/** A sentence in one language. */
export const sentence = (key, language, values) => fill(pick(SENTENCES, language)[key], values);

export const formatNumber = (value, language, digits = 2) =>
  new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/** Metres -> metres or feet, 2 decimals. */
export const toUnit = (metres, imperial) =>
  Math.round((imperial ? metres * FEET_PER_METRE : metres) * 100) / 100;

/** Metres or feet -> metres. */
export const fromUnit = (value, imperial) => (imperial ? value / FEET_PER_METRE : value);

/** °C -> °C or °F, 1 decimal. */
export const toTemperature = (celsius, imperial) =>
  Math.round((imperial ? (celsius * 9) / 5 + 32 : celsius) * 10) / 10;

export const heightUnit = (imperial) => (imperial ? 'ft' : 'm');

/** "1.80 m", "5.91 ft", "1,80 m". */
export const formatHeight = (metres, language, imperial) =>
  `${formatNumber(toUnit(metres, imperial), language)} ${heightUnit(imperial)}`;

/** "5:39 PM", "17:39". */
export const formatTime = (at, language) =>
  new Intl.DateTimeFormat(localeOf(language), {
    hour: hourOf(language),
    minute: '2-digit',
  }).format(new Date(at));

/** "Sat 5:39 PM", "sam. 17:39". */
export const formatDayTime = (at, language) =>
  new Intl.DateTimeFormat(localeOf(language), {
    weekday: 'short',
    hour: hourOf(language),
    minute: '2-digit',
  }).format(new Date(at));

/** "High tide at 5:39 PM (1.80 m)". */
export function tideSentence(tide, language, imperial) {
  if (!tide) {
    return null;
  }
  return sentence('tideAt', language, {
    tide: pick(TIDE_NAMES, language)[tide.type],
    time: formatTime(tide.at, language),
    height: formatHeight(tide.height, language, imperial),
  });
}

export const tideName = (type, language) => pick(TIDE_NAMES, language)[type];
export const trendName = (trend, language) => pick(TREND_NAMES, language)[trend];
