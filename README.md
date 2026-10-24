# NOAA Tides for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that brings the **tide
predictions of NOAA** (CO-OPS, Tides & Currents) for the 3,500 tide stations of the **United
States** and its territories: next high and low tides, predicted water level, rising or falling,
and the observed water level and water temperature where the station measures them. No account,
no API key.

It is the United States counterpart of
[**Marées France**](https://github.com/William-De71/gladys-marees-france) by William-De71 (the
harbours of France, SHOM data), whose features, triggers and widget it follows as far as NOAA
allows.

> **Not for navigation.** Astronomical predictions, without wind or pressure. Not affiliated with
> NOAA.

## Features

- **One device per station**: predicted level now, tide (rising / falling), next tide as text,
  minutes to the next high and low tides and their heights; observed water level and water
  temperature at the stations with an active sensor. Heights above MLLW in metres or feet,
  temperatures in °C or °F.
- **Scene triggers**: high or low tide (at its time or up to 6 h before); high tide above an alert
  level (yours, per station, or the NOAA minor flood level), up to 24 h before.
- **Scene action**: get the next tide (time, height, minutes, sentence) for the following actions.
- **Dashboard widget** "Next tides": live tiles, the tide curve with its high and low tides and a
  "now" marker, the next four tides.
- **Find stations**: near the house, near a latitude/longitude, by name or by id.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Internet access to `api.tidesandcurrents.noaa.gov`.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-noaa-tides` (or install it from the catalog once it is
   listed). The install screen shows the **location** access it asks for (used only by "Find
   stations").
2. In **Configuration**, press **Find stations**, copy the ids you want into **Stations** (names
   work too: `9414290, Boston`), choose the units, then save.
3. Open the **Discover** tab and press **Add to Gladys** on the stations.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTPS──▶ api.tidesandcurrents.noaa.gov
      │                            mdapi …/stations.json?type=tidepredictions   list, once a week
      │                            mdapi …/stations/<id>.json?expand=…          each station, once a week
      │                            datagetter predictions hilo + 6-minute       each station, every 6 h
      │                            datagetter water_level, water_temperature    created devices, every 6 min
      │ SDK (WebSocket + host API)
      ▼
Gladys core ── devices, states, scene events, scene action, widget
```

- Devices are published with `should_poll: false`: the integration computes the states every
  minute from the predictions it holds (the countdowns move every minute) and publishes only the
  changes, plus a heartbeat every 12 hours.
- Reference stations give a 6-minute predicted curve; subordinate stations give their high and low
  tides only, and the level in between is interpolated by the cosine method of the tide tables.
- The station details give the active sensors (water level, water temperature) and the NOAA minor
  flood level, converted from the station datum to MLLW.
- Scene events are computed from the predicted high and low tides, one per offset chosen in the
  manifest (scene filters only compare by equality). A container stopped for more than 15 minutes
  does not replay the events it missed.

## Limitations

- NOAA tide stations only: no currents, no Great Lakes levels, heights above MLLW only.
- Predictions are astronomical; the observed level shows the real water.
- Times are shown in the timezone of Gladys, not of the station.
- Tested against recorded NOAA answers and the SDK's fake Gladys; not yet on a real Gladys
  instance: feedback welcome.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and recorded API answers
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → monitor, configuration action, scene action, widget
src/monitor.js        followed stations, refreshes, states, scene triggers, scene action outputs
src/noaa.js           NOAA CO-OPS client and parsing
src/tides.js          tide arithmetic (level now, next tide, trend, curve)
src/devices.js        Gladys device of a station (features, names)
src/search.js         "Find stations" action
src/widgets.js        dashboard widget
src/messages.js       texts and formats, four languages
src/http.js, geo.js, store.js, config.js
test/fixtures/noaa/   NOAA answers recorded on 24/10/2026 (San Francisco, The Battery, Boston, Hull)
```

Versions are bumped by the **Release** workflow (Actions → Release), never by hand.

## Credits

- Data: **NOAA CO-OPS** (Center for Operational Oceanographic Products and Services), Tides &
  Currents APIs, public domain.
- [Marées France](https://github.com/William-De71/gladys-marees-france) by William-De71, for the
  design of the devices, triggers and widget.
- Home Assistant has an equivalent integration,
  [`noaa_tides`](https://www.home-assistant.io/integrations/noaa_tides/) (library
  [GClunies/noaa_coops](https://github.com/GClunies/noaa_coops)); no code copied.
- The cover shows the NOAA emblem
  ([Wikimedia Commons](https://commons.wikimedia.org/wiki/File:NOAA_logo.svg), colours from
  [noaa.gov](https://www.noaa.gov/office-of-communication/about-noaa-emblem-and-logo)) on a NOAA
  blue gradient, to name the data source. The emblem is an official insignia of NOAA; its use here
  implies no endorsement.

Not affiliated with NOAA.

## License

Apache-2.0, see [LICENSE](LICENSE).
