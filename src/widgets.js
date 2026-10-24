// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `next_tides`, for one
// station (the setting, else the first created one):
//   - heading: the station; caption: the source and the datum;
//   - live tiles bound to the device features: predicted level, and the
//     observed level and water temperature when the station measures them;
//   - chart: the predicted curve from 2 hours ago to 22 hours ahead, the high
//     and low tides as annotations ("5:39 PM 1.80 m"), a "now" marker;
//   - status: the next four tides, and the alert level of the high tide trigger;
//   - a button to the station page on Tides & Currents.
// Budget: 2 texts, 3 tiles, 1 chart, 1 status, 1 button (8 components).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stationIdOf, stationIds } from './devices.js';
import {
  formatDayTime,
  formatNumber,
  formatHeight,
  formatTime,
  heightUnit,
  tideName,
  toUnit,
  trendName,
} from './messages.js';
import { WIDGET_KEY } from './monitor.js';
import { stationPage } from './noaa.js';
import { HOUR, MINUTE, series } from './tides.js';

export const TTL_SECONDS = 300;
const MAX_TIDES = 4;
const MAX_STATUS_TEXT = 40;
const MAX_ANNOTATION = 16;

export const TEXT = {
  empty: {
    en: 'No station followed yet: fill in the configuration of the NOAA Tides integration, then create the devices in the Discover tab.',
    fr: "Aucune station suivie pour l'instant : remplissez la configuration de l'intégration NOAA Tides, puis créez les appareils dans l'onglet Découverte.",
    de: 'Noch keine Station verfolgt: Fülle die Konfiguration der Integration NOAA Tides aus und lege dann die Geräte im Tab „Entdecken“ an.',
    es: 'Aún no se sigue ninguna estación: rellene la configuración de la integración NOAA Tides y, después, cree los dispositivos en la pestaña Descubrir.',
  },
  gone: {
    en: 'This station is no longer followed.',
    fr: "Cette station n'est plus suivie.",
    de: 'Diese Station wird nicht mehr verfolgt.',
    es: 'Esta estación ya no se sigue.',
  },
  waiting: {
    en: 'Waiting for the NOAA predictions.',
    fr: 'En attente des prédictions de la NOAA.',
    de: 'Warte auf die Vorhersagen der NOAA.',
    es: 'Esperando las predicciones de la NOAA.',
  },
  predicted: { en: 'Predicted', fr: 'Prédite', de: 'Vorhergesagt', es: 'Prevista' },
  observed: { en: 'Observed', fr: 'Mesurée', de: 'Gemessen', es: 'Medida' },
  water: { en: 'Water', fr: 'Eau', de: 'Wasser', es: 'Agua' },
  curve: {
    en: 'Predicted level',
    fr: 'Hauteur prédite',
    de: 'Vorhergesagter Stand',
    es: 'Nivel previsto',
  },
  alertLevel: {
    en: 'Alert level',
    fr: "Seuil d'alerte",
    de: 'Warnpegel',
    es: 'Nivel de alerta',
  },
  minorFlood: {
    en: 'NOAA minor flood',
    fr: 'crue mineure NOAA',
    de: 'NOAA leichte Überflutung',
    es: 'inundación menor NOAA',
  },
  source: {
    en: 'NOAA CO-OPS · heights above MLLW',
    fr: 'NOAA CO-OPS · hauteurs au-dessus de MLLW',
    de: 'NOAA CO-OPS · Höhen über MLLW',
    es: 'NOAA CO-OPS · alturas sobre MLLW',
  },
  site: {
    en: 'Tides & Currents',
    fr: 'Tides & Currents',
    de: 'Tides & Currents',
    es: 'Tides & Currents',
  },
};

const t = (entry, language) => entry[language] ?? entry.en;
const clip = (value, max = MAX_STATUS_TEXT) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

function stationContent(monitor, id, language) {
  const now = monitor.now();
  const imperial = monitor.config.imperial;
  const view = monitor.view(id, now);
  const ids = stationIds(monitor.gladys, id);
  const created = new Set(
    (monitor.devices.get(id)?.features ?? []).map((feature) => feature.external_id),
  );
  const heading = view.trend
    ? `${view.station.name} · ${trendName(view.trend, language)}`
    : view.station.name;
  const components = [
    { type: 'text', variant: 'heading', text: clip(heading) },
    { type: 'text', variant: 'caption', text: t(TEXT.source, language) },
  ];
  for (const [key, label] of [
    ['level', TEXT.predicted],
    ['observed_level', TEXT.observed],
    ['water_temperature', TEXT.water],
  ]) {
    if (created.has(ids[key])) {
      components.push({ type: 'value', label: t(label, language), device_feature: ids[key] });
    }
  }
  const from = now - 2 * HOUR;
  const to = now + 22 * HOUR;
  const points = series(view.predictions, from, to, 12 * MINUTE);
  if (points.length > 1) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: t(TEXT.curve, language),
      unit: heightUnit(imperial),
      series: [
        {
          name: t(TEXT.predicted, language),
          points: points.map((point) => ({
            t: new Date(point.at).toISOString(),
            v: toUnit(point.height, imperial),
          })),
        },
      ],
      annotations: view.predictions.extremes
        .filter((tide) => tide.at >= from && tide.at <= to)
        .slice(0, 8)
        .map((tide) => ({
          t: new Date(tide.at).toISOString(),
          value: toUnit(tide.height, imperial),
          // The chart carries the unit: "10:39 PM -1.25" fits the 16 characters.
          label: clip(
            `${formatTime(tide.at, language)} ${formatNumber(toUnit(tide.height, imperial), language)}`,
            MAX_ANNOTATION,
          ),
          color: tide.type === 'H' ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.INFO,
        })),
      now_marker: true,
    });
  }
  const items = view.predictions.extremes
    .filter((tide) => tide.at > now)
    .slice(0, MAX_TIDES)
    .map((tide) => ({
      label: tideName(tide.type, language),
      value: clip(
        `${formatDayTime(tide.at, language)} · ${formatHeight(tide.height, language, imperial)}`,
      ),
      icon: tide.type === 'H' ? 'arrow-up' : 'arrow-down',
      color: WIDGET_COLORS.NEUTRAL,
    }));
  const alert = monitor.alertLevel(id);
  if (alert) {
    const level = formatHeight(alert.metres, language, imperial);
    items.push({
      label: t(TEXT.alertLevel, language),
      value: clip(alert.source === 'noaa' ? `${level} (${t(TEXT.minorFlood, language)})` : level),
      icon: 'alert-triangle',
      color:
        view.nextHigh && view.nextHigh.height >= alert.metres
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  } else {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.waiting, language) });
    components.splice(1, 1);
  }
  components.push({
    type: 'button',
    label: t(TEXT.site, language),
    icon: 'external-link',
    link: { url: stationPage(id) },
  });
  return components;
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' } = {}) {
      const lang = TEXT.empty[language] ? language : 'en';
      const body = (entry) => [{ type: 'text', variant: 'body', text: t(entry, lang) }];
      const chosen = typeof settings?.station === 'string' ? settings.station : null;
      const created = monitor.created();
      let id = null;
      if (chosen) {
        id = stationIdOf(monitor.gladys, chosen);
        if (!id || !created.some((station) => station.id === id)) {
          return { ttl_seconds: TTL_SECONDS, components: body(TEXT.gone) };
        }
      } else if (created.length > 0) {
        id = created[0].id;
      } else {
        return { ttl_seconds: TTL_SECONDS, components: body(TEXT.empty) };
      }
      return { ttl_seconds: TTL_SECONDS, components: stationContent(monitor, id, lang) };
    },
  },
};
