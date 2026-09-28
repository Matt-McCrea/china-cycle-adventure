import type { LineString } from "geojson";

/** How much to trust a coordinate. Shown in the UI; never upgrade without a source. */
export type Confidence = "verified" | "approximate";

/** Planning status of any fact (a train, a time, an event date). */
export type Status = "confirmed" | "planned" | "tbc";

export type IconId =
  | "city" | "basketball" | "river" | "peak" | "valley" | "teahouse"
  | "train" | "market" | "oasis" | "dune" | "danxia" | "gate" | "plane"
  | "terraces" | "drum" | "karst" | "bike";

export type Chapter = {
  id: string;
  numeral: string;
  title: string;
  /** anchor for the faint chapter label on the map */
  label: { lon: number; lat: number };
};

export type Stop = {
  id: string;
  /** itinerary order, 1-based, drives the 01…13 markers */
  number: number;
  chapter: string;
  /** ISO dates, inclusive */
  dateStart: string;
  dateEnd: string;
  city: string;
  chineseName: string;
  /** optional sub-line, e.g. county / prefecture */
  locality?: string;
  region: string;
  regionZh: string;
  longitude: number;
  latitude: number;
  confidence: Confidence;
  /** where the coordinate came from, shown on hover of the Approx./Verified tag */
  coordSource: string;
  /** one-line kicker shown under the name */
  kicker: string;
  highlights: string[];
  icon: IconId;
  /** chapter-level moment: gets a larger card treatment */
  bigMoment?: string;
  /** loose plan: place, dates and route may change (shown faded, with a "Rough plan" tag) */
  tentative?: boolean;
  /** stops that should only get a number (no name) at national zoom */
  minor?: boolean;
};

/**
 * A place we might go in the loose second half. Drawn as a small hollow dot (name when zoomed in)
 * and listed on the `near` stop's card. Turns into a visited place once a journal post is tagged there.
 */
export type Idea = {
  id: string;
  name: string;
  chineseName: string;
  longitude: number;
  latitude: number;
  /** one line: why it's worth a look (facts only) */
  why: string;
  /** stop whose card lists this idea */
  near: string;
  coordSource: string;
};

/** Stations and transfer points. Not numbered; drawn as small ticks. */
export type Waypoint = {
  id: string;
  name: string;
  chineseName: string;
  longitude: number;
  latitude: number;
  confidence: Confidence;
  coordSource: string;
  /** "via" = routing point only (a stop the train makes, not ours); never drawn */
  kind: "station" | "transfer" | "via";
};

export type SegmentMode = "bike" | "rail" | "local" | "schematic";

export type RouteSegment = {
  id: string;
  /** Stop or Waypoint id */
  from: string;
  to: string;
  mode: SegmentMode;
  /** the stop this segment leads into; used to highlight a stop's arrival */
  leg: string;
  /** ISO date of travel */
  date: string;
  /** ISO arrival date, for overnight / multi-day legs */
  dateEnd?: string;
  /** what we plan to ride, in plain words */
  transport: string;
  /** riding day number (bike legs), as in the tour brief */
  day?: number;
  /** planner distance and climbing for a riding day (the drawn line is only the road alignment) */
  rideKm?: number;
  climbM?: number;
  /** e.g. "T270" — only when known; always paired with serviceStatus */
  service?: string;
  serviceStatus: Status;
  notes?: string;
  /**
   * For rail: OSM railway line relations to route along (see scripts/build-routes.ts).
   * The build writes the resulting geometry to generated/routes.geo.json.
   */
  osmLines?: number[];
  /**
   * For long rail legs that change lines: route hop by hop through these waypoints,
   * each hop restricted to its own OSM lines. The last hop ends at `to`.
   */
  osmRoute?: { via: string; lines: number[] }[];
  /** the trip's signature train ride: gets a label along the line and a slower reveal */
  longJourney?: boolean;
  /** draw the line this many px to one side, so it stays visible where it shares track with another leg */
  offsetPx?: number;
  /** for schematic legs: bend of the drawn arc, fraction of chord length (+ = left) */
  bend?: number;
  geometry?: LineString;
};
