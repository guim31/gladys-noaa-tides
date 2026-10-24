# NOAA Tides

Brings the **tide predictions of NOAA** (CO-OPS, Tides & Currents) into Gladys, at the 3,500
tide stations of the **United States** and its territories: the next high and low tides, the
predicted water level now, whether the tide is rising or falling, and, where the station measures
them, the observed water level and the water temperature. No account, no key.

For the harbours of France, use the **Marées France** integration by William-De71: this one is
its counterpart for the United States, with the same features as far as NOAA allows.

> **Not for navigation.** Predictions are astronomical: wind, pressure and river flow can move the
> real water level well away from them. The integration depends on your Gladys, your Internet
> access and a public service. Use the official NOAA products and the National Weather Service
> warnings for anything that matters. This integration is not affiliated with NOAA.

## What you get

- **One device per station** you follow, named "Tide <station>": the **predicted level** now, the
  **tide** (rising or falling), the **next tide** as a sentence ("High tide at 5:39 PM (1.80
  m)"), the **minutes to the next high tide** and **to the next low tide**, and their **heights**.
- At the stations that measure them: the **observed water level** (every 6 minutes) and the
  **water temperature**.
- Heights above **MLLW** (Mean Lower Low Water, the datum of the US nautical charts), in **metres
  or feet**; temperatures in °C or °F.
- Two **scene triggers**: a high or low tide (at its time or up to 6 hours before), and a high tide
  above an **alert level** (yours, or the NOAA minor flood level of the station), up to 24 hours
  before.
- A **scene action** that gives the next tide to the following actions (time, height, sentence).
- A **dashboard widget**: the tide curve of the day with its high and low tides, the next four
  tides and live levels.
- A **"Find stations"** button: the stations near your house, near a point, by name or by id.

## Requirements

- Gladys Assistant **5.1.0** or later (widget, scene triggers and action).
- Internet access from Gladys to `api.tidesandcurrents.noaa.gov`.
- The location of your house in Gladys, only for "Find stations" without text.

## Configuration

### Settings

- **Stations**: ids or names of the stations, separated by commas, 10 at most. An id (9414290) is
  exact. A name ("Boston", "San Francisco") takes the matching station, a reference station first.
  A tidesandcurrents.noaa.gov page with `?id=` works too.
- **Units**: metres and °C (default) or feet and °F. Gladys freezes the unit of a feature when the
  device is created: after a change, click **Update** on the devices in the Discover tab.
- **Alert levels of the high tides**: for the trigger "High tide above the alert level", in the
  units above, above MLLW. One level for every station (`2.1`), one per station
  (`9414290=2.1; 8443970=3.6`), or both. Empty: the **NOAA minor flood level** of the station,
  when it has one (water level stations).
- **Language of the texts**: of the device and feature names (frozen at creation) and of the texts
  sent to the scenes. French by default.

Save, open the **Discover** tab and create the devices you want.

### Finding your stations

The **Find stations** button lists up to 10 stations with their id, their state, their distance
and their kind:

- leave the field **empty** for the stations nearest to your house;
- type a **latitude and a longitude** (`37.8, -122.47`) for the stations nearest to that point;
- type a **name**, with its state if needed (`Sausalito CA`), or an **id**.

A **reference station** has the full 6-minute curve. A **subordinate station** only has its high
and low tides (offsets of a reference station): its level in between is computed by the cosine
interpolation of the tide tables, a few centimetres off.

## Devices

| Feature               | Type        | Notes                                                   |
| --------------------- | ----------- | ------------------------------------------------------- |
| Predicted level       | level       | now, curve of the reference stations, else interpolated |
| Tide                  | text        | Rising / Falling                                        |
| Next tide             | text        | "High tide at 5:39 PM (1.80 m)"                         |
| Next high tide in     | duration    | minutes                                                 |
| Next high tide height | level       |                                                         |
| Next low tide in      | duration    | minutes                                                 |
| Next low tide height  | level       |                                                         |
| Observed water level  | level       | stations with an active water level sensor, 6-minute    |
| Water temperature     | temperature | stations with an active water temperature sensor        |

The states are refreshed every minute by the integration itself (the countdowns move every
minute). An observation older than one hour (three for the temperature) is not sent again. Times
are shown in the timezone of your Gladys, whatever the timezone of the station.

## Dashboard widget

**Next tides**: for the station chosen in its settings (or the first one created), the predicted
level and the observed values as live tiles, the curve from 2 hours ago to 22 hours ahead with
its high and low tides and a "now" marker, the next four tides, the alert level of the high tide
trigger, and a link to the station page on Tides & Currents.

## Scene triggers

- **Tide: high or low tide**: choose the station, high tide, low tide or both, and when: at the
  time of the tide, or 15, 30, 45 minutes, 1, 1.5, 2, 3, 4 or 6 hours before. The scene receives
  the station, the tide, its time, its height, the unit and a ready-made sentence.
- **Tide: high tide above the alert level**: a predicted high tide reaches the alert level of the
  configuration (or the NOAA minor flood level): at its time, or 30 minutes to 24 hours before.
  The scene also receives the alert level.

A threshold on the observed level needs no trigger: use the Gladys condition "a device value goes
above" on the **Observed water level** feature.

## Scene action

**Tide: get the next tide**: for a station, the next high tide, low tide or either. The following
actions can use its time, its height, the minutes until it, the predicted level now, the trend
and a sentence ("High tide at 5:39 PM (1.80 m)").

## Scene examples

- **Low tide walk**: trigger "Tide: high or low tide", low tide, 1 hour before → send the sentence of
  the trigger to your phone, time to go to the beach.
- **King tide warning**: trigger "Tide: high tide above the alert level", 12 hours before → send
  the sentence to the family and close the garage door in time.
- **Morning briefing**: at 7 AM, action "Tide: get the next tide", then send its sentence with the
  weather.

## Data sources and quotas

- Data: **NOAA CO-OPS** (Center for Operational Oceanographic Products and Services), API
  `api.tidesandcurrents.noaa.gov`, public domain. No key; every request names the application
  (`application=gladys-noaa-tides`), as NOAA asks.
- Requests, per station: details once a week, predictions every 6 hours (2 requests), latest
  observations every 6 minutes for the created devices whose station measures them (1 or 2
  requests). The station list (about 3,500 stations) once a week, kept in `/data`.
- Predictions use the epoch and the datums published by NOAA; they cover the next two days, so a
  short outage of NOAA changes nothing.

## Troubleshooting

- **"Unknown station"** on the Configuration screen: the id or the name is not in the NOAA list of
  the tide stations. Use **Find stations** and copy the id.
- **No observed level or temperature**: the station has no active sensor (most stations only
  have predictions). NOAA marks a broken sensor as inactive: the feature appears again after
  "Update" in the Discover tab once it is repaired.
- **Heights in metres after choosing feet**: click **Update** on the device in the Discover tab.
- **"NOAA Tides & Currents does not answer"**: the service is down or unreachable from Gladys;
  the countdowns and the triggers keep running on the predictions already known.
- Detailed logs: set `LOG_LEVEL=debug` on the container.

## Limits

- Tide stations of NOAA only (United States, Puerto Rico, the Pacific islands…): no currents, no
  Great Lakes levels.
- Heights above MLLW only; other datums are not offered.
- Not for navigation: astronomical predictions, without wind or pressure.
- The NOAA minor flood level exists only at the water level stations.
- This integration is not affiliated with NOAA.
