import { useEffect, useRef } from "react";
import type { JournalEntry } from "../data/journal";
import { STOPS, TRIP } from "../data/itinerary";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "16 Oct · 21:30" in China time (UTC+8), where the post was written. */
export function postTime(iso: string) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600e3);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const cityOf = (id: string) => STOPS.find((s) => s.id === id)?.city ?? "";

function where(e: JournalEntry) {
  if (e.locSource === "plan") return e.place ? `${e.place.name} · no exact location sent` : `Around ${cityOf(e.stopId)} · no exact location sent`;
  if (e.locSource === "named") return `${e.place?.name ?? ""}${e.place?.zh ? ` ${e.place.zh}` : ""} · placed by name`;
  const lat = `${Math.abs(e.lat!).toFixed(3)}° ${e.lat! >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(e.lon!).toFixed(3)}° ${e.lon! >= 0 ? "E" : "W"}`;
  return `${e.place ? `${e.place.name}${e.place.zh ? ` ${e.place.zh}` : ""} · ` : ""}${lat}, ${lon} · ${e.locSource === "photo" ? "from photo" : "sent from the road"}`;
}

export function PostThumbs({ posts, onOpen }: { posts: JournalEntry[]; onOpen: (id: string) => void }) {
  return (
    <ul className="post-list">
      {posts.map((p) => (
        <li key={p.id}>
          <button type="button" className="post-row" onClick={() => onOpen(p.id)}>
            {p.photos[0] ? <img src={p.photos[0].thumb} alt="" loading="lazy" width={56} height={56} /> : <span className="post-nophoto" aria-hidden="true" />}
            <span className="post-row-body">
              <b>{p.title}</b>
              <small>{postTime(p.date)} · {p.place?.name ?? cityOf(p.stopId)}</small>
              {p.text && <span className="post-snippet">{p.text.slice(0, 90)}{p.text.length > 90 ? "…" : ""}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PostViewer({ post, onClose, onPrev, onNext }: { post: JournalEntry; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [post.id]);
  return (
    <div className="post-backdrop" onClick={onClose} data-map-ui>
      <div
        ref={ref}
        className="post"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowLeft" && onPrev) onPrev();
          if (e.key === "ArrowRight" && onNext) onNext();
        }}
      >
        <header className="post-head">
          <span className="post-kicker">From the road · {postTime(post.date)} China time</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close post">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </header>
        <h2 id="post-title" className="post-title">{post.title}</h2>
        <p className="post-where">{where(post)}</p>
        {post.photos.length > 0 && (
          <div className="post-photos">
            {post.photos.map((ph, i) => (
              <a key={ph.src} href={ph.src} target="_blank" rel="noreferrer">
                <img src={ph.src} alt={`Photo ${i + 1} of ${post.photos.length}: ${post.title}`} width={ph.w} height={ph.h} loading={i ? "lazy" : "eager"} />
              </a>
            ))}
          </div>
        )}
        {post.text && <div className="post-text">{post.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div>}
        {(onPrev || onNext) && (
          <nav className="card-nav" aria-label="Posts">
            <button type="button" className="nav-btn" disabled={!onPrev} onClick={onPrev}>← Earlier</button>
            <button type="button" className="nav-btn nav-next" disabled={!onNext} onClick={onNext}>Later →</button>
          </nav>
        )}
      </div>
    </div>
  );
}

export function NewPopup({ posts, firstVisit, onOpen, onDismiss, onOpenJournal }: {
  posts: JournalEntry[];
  firstVisit: boolean;
  onOpen: (id: string) => void;
  onDismiss: () => void;
  onOpenJournal: () => void;
}) {
  const list = [...posts].reverse();
  const [top, ...rest] = list;
  const cover = top.photos[0];
  return (
    <aside className="news news-big" role="dialog" aria-labelledby="news-title" data-map-ui>
      <header className="news-head">
        <span className="news-flag">New</span>
        <h2 id="news-title">{firstVisit ? "Latest from the road" : `${posts.length} new ${posts.length === 1 ? "post" : "posts"} from the road`}</h2>
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      </header>
      <button type="button" className="news-hero" onClick={() => onOpen(top.id)}>
        {cover && <img src={cover.src} alt="" width={cover.w} height={cover.h} />}
        <span className="news-hero-body">
          <small>{postTime(top.date)} · {top.place?.name ?? cityOf(top.stopId)} · {timeAgo(top.date)}</small>
          <b>{top.title}</b>
          {top.text && <span className="post-snippet">{top.text.slice(0, 120)}{top.text.length > 120 ? "…" : ""}</span>}
        </span>
      </button>
      {rest.length > 0 && <PostThumbs posts={rest.slice(0, 2)} onOpen={onOpen} />}
      <div className="news-actions">
        <button type="button" className="welcome-go" onClick={onOpenJournal}>Open journal{posts.length > 1 ? ` (${posts.length} new)` : ""}</button>
        <button type="button" className="nav-btn" onClick={onDismiss}>Later</button>
      </div>
    </aside>
  );
}

/** The big Journal button: latest photo, post count, and a NEW flag when there's news. */
export function JournalButton({ posts, isNew, open, onClick }: { posts: JournalEntry[]; isNew: boolean; open: boolean; onClick: () => void }) {
  const latestPhoto = [...posts].reverse().find((p) => p.photos[0])?.photos[0];
  return (
    <button type="button" className={`journal-btn ${isNew ? "is-new" : ""}`} onClick={onClick} aria-expanded={open} data-map-ui>
      {latestPhoto ? <img src={latestPhoto.thumb} alt="" width={36} height={36} /> : <span className="jb-icon" aria-hidden="true" />}
      <span className="jb-text">
        <b>Journal</b>
        <small>{posts.length ? `${posts.length} ${posts.length === 1 ? "post" : "posts"}` : "from the road"}</small>
      </span>
      {isNew && <span className="news-flag">New</span>}
    </button>
  );
}

export function JournalPanel({ posts, onOpen, onClose }: { posts: JournalEntry[]; onOpen: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const list = [...posts].reverse();
  return (
    <aside
      ref={ref}
      className="journal-drawer"
      role="dialog"
      aria-labelledby="jp-title"
      tabIndex={-1}
      data-map-ui
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <header className="jd-head">
        <div>
          <p className="post-kicker">From the road · {posts.length} {posts.length === 1 ? "post" : "posts"}</p>
          <h2 id="jp-title" className="jd-title">Journal</h2>
          {list[0] && <p className="news-sub">Latest {timeAgo(list[0].date)}</p>}
          <p className="jd-post">Riders: email posts and photos to <a href={`mailto:${TRIP.journalEmail}`}>{TRIP.journalEmail}</a>. Map tags are explained under "How this works".</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close journal">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>
        </button>
      </header>
      {list.length ? (
        <ul className="jd-list">
          {list.map((p) => {
            const stop = STOPS.find((s) => s.id === p.stopId);
            return (
              <li key={p.id}>
                <button type="button" className="jd-card" onClick={() => onOpen(p.id)}>
                  {p.photos[0] && (
                    <span className="jd-photo">
                      <img src={p.photos[0].src} alt="" loading="lazy" width={p.photos[0].w} height={p.photos[0].h} />
                      {p.photos.length > 1 && <span className="jd-more">+{p.photos.length - 1}</span>}
                    </span>
                  )}
                  <span className="jd-body">
                    <small>
                      {postTime(p.date)} · {p.place?.name ?? stop?.city}
                      {stop && <span className="jd-stop"> · stop {String(stop.number).padStart(2, "0")}</span>}
                    </small>
                    <b>{p.title}</b>
                    {p.text && <span className="post-snippet">{p.text.slice(0, 200)}{p.text.length > 200 ? "…" : ""}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="jd-empty">Nothing yet. Posts will appear here once the trip starts on 10 October.</p>
      )}
    </aside>
  );
}
