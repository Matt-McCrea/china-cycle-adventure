import { geoConicEqualArea, type GeoProjection } from "d3-geo";

/**
 * The one projection used everywhere (map rendering, build scripts, relief raster).
 * Albers equal-area conic, standard parallels 25°N / 47°N, central meridian 105°E:
 * the conventional national projection for maps of China. Areas stay proportional,
 * so Xinjiang is not inflated the way it is in Web Mercator.
 *
 * "World units": scale 1000 (earth radius = 1000 units), origin at 105°E / 35.5°N.
 * One world unit ≈ 6.37 km.
 */
export const PROJECTION = {
  rotate: [-105, 0] as [number, number],
  center: [0, 35.5] as [number, number],
  parallels: [25, 47] as [number, number],
  scale: 1000,
};

export function baseProjection(): GeoProjection {
  return geoConicEqualArea()
    .parallels(PROJECTION.parallels)
    .rotate(PROJECTION.rotate)
    .center(PROJECTION.center)
    .scale(PROJECTION.scale)
    .translate([0, 0])
    .precision(0.2);
}

/** Planar extent (world units) that the pre-projected basemap and relief cover. */
export const WORLD_EXTENT: [[number, number], [number, number]] = [
  [-820, -560],
  [640, 470],
];
