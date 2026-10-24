# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

### Added

- One device per NOAA tide station (United States and territories): predicted level now, rising
  or falling, next tide as text, minutes to the next high and low tides and their heights, and
  the observed water level and water temperature at the stations that measure them. Metres and
  °C, or feet and °F; heights above MLLW.
- Scene triggers: high or low tide (at its time or up to 6 hours before), and high tide above an
  alert level (per station, or the NOAA minor flood level) up to 24 hours before.
- Scene action "get the next tide" (time, height, minutes, sentence).
- Dashboard widget "Next tides": live tiles, tide curve with its high and low tides, next four
  tides.
- "Find stations" button: near the house, near a latitude and longitude, by name or by id.
- Texts and documentation in English, French, German and Spanish.

## [Unreleased]

### Added

- A working example of scene triggers, scene actions and dashboard widgets
  (Gladys 5.1.0 or later).
- `CHANGELOG.md`, rolled by the Release workflow.
- A GitHub Release for every version, with its changelog section as notes: the
  Gladys Supervision page links each version to the repository's releases.
- CI runs the tests on Node 22 and 24, and builds the Docker image.
- Dependabot keeps the npm dependencies and the GitHub Actions up to date.
- `SECURITY.md` (how to report a vulnerability) and `CLAUDE.md` (project rules
  for contributors and coding assistants).
- Manifest tests: `version` matches `package.json`, `docker_image` is tagged
  with it, descriptions hold 10 to 100 characters, placeholders are
  multi-language objects.
- The latitude and longitude fields show an example value as placeholder.

### Changed

- Node.js 22 or later is required (Node 20 is end-of-life).
- Integration SDK 0.15.0. The tests now run against the fake Gladys of the
  SDK, which refuses the payloads Gladys refuses.
- The refresh interval is one minute minimum, the fastest Gladys polls a
  device. The plug's power is only sent when it changes, and every 30
  minutes otherwise.

### Fixed

- Gladys refused the devices of the Discovery tab: the weather station and
  the plug declared their poll frequency in seconds instead of one of the
  values Gladys accepts, and were never polled. They now poll every minute,
  and the readings follow the refresh interval of the configuration.

- The release commit no longer fails `npm run format:check`: the Release
  workflow updates the manifest `version` and `docker_image` in place instead
  of re-printing the whole file with `jq`.
- The integration can write to `/data`: the image creates the directory owned
  by the `node` user, a new Docker volume was owned by root.
- A sub-container running the integration's own image follows it to the new
  tag at each release, as well as in the manifest of the build summary: it kept
  the previous tag, which may not exist on the registry. Sub-containers on a
  third-party image (a broker, a database...) keep theirs.

[Unreleased]: https://github.com/GladysAssistant/integration-template-js/commits/main
