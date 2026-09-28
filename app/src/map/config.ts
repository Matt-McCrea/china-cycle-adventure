/**
 * Map configuration. The basemap is built from open data at build time
 * (scripts/build-basemap.ts), so there is no tile provider to depend on.
 * To use different base data, point the build script at other sources and
 * rebuild; the renderer only consumes generated/basemap.topo.json.
 */
export const MAP_CONFIG = {
  basemap: {
    provider: "natural-earth-embedded",
    /** ISO3 codes drawn as the focus country */
    focus: ["CHN", "HKG", "MAC"],
  },
  attribution: [
    { label: "Natural Earth", href: "https://www.naturalearthdata.com" },
    { label: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
    { label: "OSRM", href: "https://project-osrm.org" },
  ],
  /** zoom limits as multiples of the whole-route fit */
  zoom: { min: 0.75, max: 40 },
  /**
   * Label detail tiers, in screen pixels per world unit (1 unit ≈ 6.37 km).
   * Below `chinese`, stops show number + English name only.
   */
  tiers: { chinese: 1.6, dates: 2.6, kicker: 7, stations: 5, provinces: 1.25 },
  /** px size of the numbered stop badges */
  badge: 24,
};
