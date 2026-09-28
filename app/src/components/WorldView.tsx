import { useEffect, useMemo, useRef, useState } from "react";
import { geoArea, geoEqualEarth, geoGraticule, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Polygon, Position } from "geojson";
import routesGeo from "../data/generated/routes.geo.json";
import { STOPS, TRIP } from "../data/itinerary";
import { MAP_CONFIG } from "../map/config";
import type { JournalEntry } from "../data/journal";
import { postTime } from "./Journal";

/**
 * The whole world, for posts sent from anywhere (Beijing on the way home, or from home before the trip).
 * A plain Equal Earth world map: the route map's China projection can't show the whole globe without
 * tearing the Americas apart. Countries are loaded on first open (generated/world.topo.json, ~300 kB).
 */
/**
 * d3 reads a spherical polygon's ring direction to know which side is inside. Simplification can flip tiny
 * rings, which then cover the whole globe: reverse any exterior ring that claims more than a hemisphere, and
 * any hole that doesn't (no country is bigger than a hemisphere; Antarctica is left out).
 */
function fixWinding(fc: FeatureCollection): FeatureCollection {
  const big = (ring: Position[]) => geoArea({ type: "Polygon", coordinates: [ring] } as Polygon) > 2 * Math.PI;
  const fixPoly = (rings: Position[][]) => [
    big(rings[0]) ? [...rings[0]].reverse() : rings[0],
    ...rings.slice(1).map((r) => (big(r) ? r : [...r].reverse())),
  ];
  for (const f of fc.features) {
    const g = f.geometry as any;
    if (g?.type === "Polygon") g.coordinates = fixPoly(g.coordinates);
    else if (g?.type === "MultiPolygon") g.coordinates = g.coordinates.map(fixPoly);
  }
  return fc;
}

export function WorldView({ posts, onOpenPost, onClose }: { posts: JournalEntry[]; onOpenPost: (id: string) => void; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [world, setWorld] = useState<FeatureCollection | null>(null);
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<string | null>(null);
  const zoomer = useRef(zoom<SVGSVGElement, unknown>().scaleExtent([0.8, 14]));

  useEffect(() => {
    import("../data/generated/world.topo.json").then((m) => {
      const topo = m.default as unknown as Topology;
      setWorld(fixWinding(feature(topo, topo.objects.countries) as unknown as FeatureCollection));
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    const z = zoomer.current.on("zoom", (e) => setT(e.transform));
    select(el).call(z).on("dblclick.zoom", null);
    el.focus();
    return () => ro.disconnect();
  }, []);

  const located = posts.filter((p) => p.locSource !== "plan" && p.lat != null && p.lon != null);

  // frame Europe → East Asia → Australia (home to the trip), stretched to take in any post outside it
  const proj = useMemo(() => {
    const pts: [number, number][] = [[-12, 62], [150, 62], [-12, -38], [150, -38], ...located.map((p) => [p.lon!, p.lat!] as [number, number])];
    const pad = size.w < 720 ? 16 : 48;
    return geoEqualEarth().fitExtent(
      [[pad, size.w < 720 ? 120 : 150], [Math.max(pad + 1, size.w - pad), Math.max(200, size.h - (size.w < 720 ? 110 : 70))]],
      { type: "MultiPoint", coordinates: pts },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, located.length]);
  const path = geoPath(proj);
  const focus = new Set(MAP_CONFIG.basemap.focus);
  const k = t.k;

  const zoomBy = (f: number) => select(svgRef.current!).transition().duration(300).call(zoomer.current.scaleBy, f);
  const reset = () => select(svgRef.current!).transition().duration(400).call(zoomer.current.transform, zoomIdentity);

  const hovered = located.find((p) => p.id === hover);
  const hp = hovered ? proj([hovered.lon!, hovered.lat!]) : null;
  const first = proj([STOPS[0].longitude, STOPS[0].latitude]);
  const last = proj([STOPS[STOPS.length - 1].longitude, STOPS[STOPS.length - 1].latitude]);

  return (
    <div className="world" data-map-ui>
      <svg
        ref={svgRef}
        className="world-svg"
        tabIndex={0}
        role="img"
        aria-label={`World map showing the route in China and ${located.length} located journal ${located.length === 1 ? "post" : "posts"}`}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <g transform={t.toString()}>
          <path className="world-sphere" d={path({ type: "Sphere" }) ?? ""} />
          <path className="world-grat" d={path(geoGraticule().step([30, 30])()) ?? ""} style={{ strokeWidth: 0.6 / k }} />
          {world?.features.map((f, i) => (
            <path key={i} className={focus.has(f.properties?.a3) ? "world-focus" : "world-land"} d={path(f) ?? ""} style={{ strokeWidth: 0.5 / k }} />
          ))}
          {(routesGeo as any).features.map((f: any) => (
            <path key={f.properties.id} className={`world-route is-${f.properties.mode}`} d={path(f) ?? ""} style={{ strokeWidth: 2.4 / k }} />
          ))}
          {first && last && (
            <g className="world-trip" style={{ fontSize: 12 / k }}>
              <circle cx={first[0]} cy={first[1]} r={3 / k} />
              <circle cx={last[0]} cy={last[1]} r={3 / k} />
              {/* label to the right of the route, or to its left when it would run off screen (phones) */}
              {t.applyX(last[0]) > size.w - 180 ? (
                <text x={first[0] - 8 / k} y={last[1] + 14 / k} textAnchor="end">{TRIP.title}</text>
              ) : (
                <text x={last[0] + 8 / k} y={last[1] + 14 / k}>{TRIP.title}</text>
              )}
            </g>
          )}
          {located.map((p) => {
            const xy = proj([p.lon!, p.lat!]);
            if (!xy) return null;
            return (
              <g
                key={p.id}
                className="world-pin"
                transform={`translate(${xy[0]},${xy[1]}) scale(${1 / k})`}
                role="button"
                tabIndex={0}
                aria-label={`${p.title}, ${p.place?.name ?? ""} ${postTime(p.date)}`}
                onClick={() => onOpenPost(p.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenPost(p.id)}
                onPointerEnter={() => setHover(p.id)}
                onPointerLeave={() => setHover(null)}
              >
                <circle r={9} className="world-pin-hit" />
                <circle r={5.5} />
              </g>
            );
          })}
        </g>
      </svg>
      {hovered && hp && (
        <div className="world-tip" style={{ left: t.applyX(hp[0]) + 12, top: t.applyY(hp[1]) + 12 }}>
          <b>{hovered.title}</b>
          <small>{postTime(hovered.date)}{hovered.place ? ` · ${hovered.place.name}` : ""}</small>
        </div>
      )}
      <div className="world-bar">
        <p className="world-note">
          <b>World view</b> · {located.length ? `${located.length} ${located.length === 1 ? "post" : "posts"} with a location. Tap a pin to read it.` : "Posts with a location show here as pins."}
        </p>
        <div className="ctrl-group" role="group" aria-label="World zoom">
          <button type="button" className="ctrl" onClick={() => zoomBy(1.8)} aria-label="Zoom in">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" className="ctrl" onClick={() => zoomBy(1 / 1.8)} aria-label="Zoom out">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
          </button>
          <button type="button" className="ctrl" onClick={reset} aria-label="Reset world view" title="Reset">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
          </button>
        </div>
        <button type="button" className="welcome-go world-back" onClick={onClose}>← Back to the route</button>
      </div>
    </div>
  );
}
