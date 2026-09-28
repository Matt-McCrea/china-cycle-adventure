import { IDEAS, SEGMENTS, STOPS } from "../data/itinerary";
import type { RouteSegment, Stop } from "../data/types";
import { approxKm, dateRange, pad2, stopDates } from "../data/format";
import { Icon } from "./Icon";
import { PostThumbs } from "./Journal";
import type { JournalEntry } from "../data/journal";

export type SegLengths = Map<string, number | undefined>;

const MODE_LABEL: Record<RouteSegment["mode"], string> = { bike: "Cycling", rail: "Train", local: "Transfer", schematic: "Schematic" };

export function StatusTag({ s }: { s: RouteSegment["serviceStatus"] }) {
  return <span className={`tag tag-${s}`}>{s === "tbc" ? "TBC" : s === "planned" ? "Planned" : "Confirmed"}</span>;
}

export function LegLine({ seg, km }: { seg: RouteSegment; km?: number }) {
  return (
    <li className={`leg leg-${seg.mode}`}>
      <span className="leg-mode" aria-label={MODE_LABEL[seg.mode]}>
        <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" /></svg>
      </span>
      <span className="leg-body">
        <span>
          {seg.day != null && <b className="svc">Day {seg.day} · </b>}
          {seg.transport}
          {seg.service && <b className="svc"> {seg.service}</b>}
        </span>
        <span className="leg-meta">
          {seg.rideKm != null ? (
            <>
              <span className="tag tag-ride">{seg.rideKm.toLocaleString("en-GB")} km</span>
              {seg.climbM != null && <span className="tag tag-ride">↑ {seg.climbM.toLocaleString("en-GB")} m</span>}
            </>
          ) : (
            <>
              <StatusTag s={seg.serviceStatus} />
              {km != null && <span className="km">{approxKm(km)}</span>}
            </>
          )}
          {seg.mode === "schematic" && <span className="km">schematic line</span>}
        </span>
      </span>
    </li>
  );
}

export function StopCard({
  stop, lengths, onClose, onGo, variant, posts = [], onOpenPost, visitedIdeas,
}: {
  visitedIdeas?: Set<string>;
  stop: Stop;
  lengths: SegLengths;
  posts?: JournalEntry[];
  onOpenPost?: (id: string) => void;
  onClose: () => void;
  onGo: (id: string) => void;
  variant: "float" | "sheet";
}) {
  const i = STOPS.findIndex((s) => s.id === stop.id);
  const prev = STOPS[i - 1], next = STOPS[i + 1];
  const arrive = SEGMENTS.filter((s) => s.leg === stop.id);
  const nextLegs = next ? SEGMENTS.filter((s) => s.leg === next.id) : [];
  const longRail = nextLegs.find((s) => s.longJourney);
  const firstNextDate = nextLegs[0]?.date;

  return (
    <article className={`card card-${variant} ${stop.bigMoment ? "is-moment" : ""}`} aria-labelledby="card-title" data-map-ui>
      <header className="card-head">
        <span className="card-num">{pad2(stop.number)}</span>
        <span className="card-date">{stop.tentative ? "≈ " : ""}{stopDates(stop)}</span>
        {stop.tentative && <span className="tag tag-rough">Rough plan</span>}
        <button type="button" className="icon-btn card-close" onClick={onClose} aria-label="Close stop card">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      </header>

      <div className="card-title-row">
        <div>
          <h2 id="card-title" className="card-city">{stop.city}</h2>
          <p className="card-zh" lang="zh-Hans">{stop.chineseName}{stop.locality && <span> · {stop.locality}</span>}</p>
        </div>
        <span className="card-icon"><Icon id={stop.icon} size={stop.bigMoment ? 34 : 26} /></span>
      </div>

      <p className="card-kicker">{stop.kicker}</p>
      {stop.tentative && <p className="card-note card-rough">This part of the plan is loose and may change as we go.</p>}

      <ul className="card-highlights">
        {stop.highlights.map((h) => <li key={h}>{h}</li>)}
      </ul>

      {arrive.length > 0 && (
        <section className="card-section">
          <h3>Getting there · {dateRange(arrive[0].date, arrive[arrive.length - 1].dateEnd ?? arrive[arrive.length - 1].date)}</h3>
          <ul className="legs">
            {arrive.map((s) => <LegLine key={s.id} seg={s} km={lengths.get(s.id)} />)}
          </ul>
          {arrive.filter((s) => s.notes).map((s) => <p key={s.id} className="card-note">{s.notes}</p>)}
        </section>
      )}
      {stop.number === 1 && <p className="card-note">Arrive 10 October, 18:00. Riding starts the next morning.</p>}

      {IDEAS.some((i) => i.near === stop.id) && (
        <section className="card-section card-ideas">
          <h3>Maybe along the way · ideas, not booked</h3>
          <ul>
            {IDEAS.filter((i) => i.near === stop.id).map((i) => (
              <li key={i.id}>
                <b>{i.name}</b> <span lang="zh-Hans">{i.chineseName}</span>
                {visitedIdeas?.has(i.id) && <span className="tag tag-confirmed">Visited</span>}
                <span className="idea-why">{i.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posts.length > 0 && onOpenPost && (
        <section className="card-section card-journal">
          <h3>From the road · {posts.length} {posts.length === 1 ? "post" : "posts"}</h3>
          <PostThumbs posts={posts} onOpen={onOpenPost} />
        </section>
      )}

      <p className={`card-coord is-${stop.confidence}`} title={stop.coordSource}>
        {stop.confidence === "verified" ? "Location verified" : "Approx. location"} · {stop.coordSource}
      </p>

      <nav className="card-nav" aria-label="Stops">
        <button type="button" className="nav-btn" disabled={!prev} onClick={() => prev && onGo(prev.id)}>
          <span aria-hidden="true">←</span> {prev ? prev.city : "Start"}
        </button>
        {next ? (
          <button type="button" className="nav-btn nav-next" onClick={() => onGo(next.id)}>
            <small>{longRail ? `${dateRange(firstNextDate!)} · long rail journey` : `Next · ${stopDates(next)}`}</small>
            {pad2(next.number)} {next.city} <span aria-hidden="true">→</span>
          </button>
        ) : (
          <span className="nav-btn nav-end"><small>19 OCT · Guilin airport</small>Fly home <Icon id="plane" size={14} /></span>
        )}
      </nav>
    </article>
  );
}
