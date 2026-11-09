"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import type { Kind, Notice, Status } from "@/lib/types";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const NYC: [number, number] = [-73.96, 40.73];

const KIND_LABEL: Record<Kind, string> = {
  film: "Film",
  tv: "TV",
  commercial: "Commercial",
  "music-video": "Music video",
  other: "Other",
};

type Filter = "all" | Status;

function toGeoJSON(list: Notice[]) {
  return {
    type: "FeatureCollection" as const,
    features: list.map((n) => ({
      type: "Feature" as const,
      id: n.id,
      properties: {
        id: n.id,
        status: n.status,
        codename: n.codename,
        // 0–1; drives the inner-fill radius on the map (empty ring → solid dot)
        conf: Math.max(0, Math.min(1, n.match?.confidence ?? 0)),
      },
      geometry: { type: "Point" as const, coordinates: [n.lng, n.lat] },
    })),
  };
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Explorer({ notices }: { notices: Notice[] }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notices.filter((n) => {
      if (filter !== "all" && n.status !== filter) return false;
      if (!q) return true;
      return [n.codename, n.realTitle, n.place, n.borough, n.notes]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q));
    });
  }, [notices, query, filter]);

  const selected = notices.find((n) => n.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c = { all: notices.length, decoded: 0, hunch: 0, unknown: 0 };
    notices.forEach((n) => c[n.status]++);
    return c;
  }, [notices]);

  // init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !mapEl.current) return;
      // Turbopack doesn't resolve MapLibre's default worker URL; serve it from
      // /public instead (copied there by scripts/copy-maplibre-worker.mjs).
      maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
      const map = new maplibregl.Map({
        container: mapEl.current,
        style: STYLE_URL,
        center: NYC,
        zoom: 11.2,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      mapRef.current = map;

      map.on("load", () => {
        map.addSource("notices", { type: "geojson", data: toGeoJSON([]), promoteId: "id" });
        map.addLayer({
          id: "notice-halo",
          type: "circle",
          source: "notices",
          paint: {
            "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 16, 0],
            "circle-radius-transition": { duration: 220, delay: 0 },
            "circle-color": "#ffd400",
            "circle-opacity": 0.55,
          },
        });
        // outer ring — a paper disc with an ink outline, identical for every notice.
        // (A full disc, so it owns the whole hit area even though the fill sits on top.)
        map.addLayer({
          id: "notice-ring",
          type: "circle",
          source: "notices",
          paint: {
            // hover bump lives inside the interpolate outputs so the zoom stays top-level
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              10, ["case", ["boolean", ["feature-state", "hover"], false], 7, 4.5],
              15, ["case", ["boolean", ["feature-state", "hover"], false], 10.5, 8],
            ],
            "circle-radius-transition": { duration: 160, delay: 0 },
            "circle-color": "#f5f2ea",
            "circle-stroke-color": "#111111",
            "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.25, 1.75],
            "circle-stroke-width-transition": { duration: 160, delay: 0 },
          },
        });
        // inner fill — ink; radius scales with confidence (empty ring = mystery, solid = sure)
        map.addLayer({
          id: "notice-fill",
          type: "circle",
          source: "notices",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              10, ["*", ["case", ["boolean", ["feature-state", "hover"], false], 7, 4.5], ["get", "conf"]],
              15, ["*", ["case", ["boolean", ["feature-state", "hover"], false], 10.5, 8], ["get", "conf"]],
            ],
            "circle-radius-transition": { duration: 160, delay: 0 },
            "circle-color": "#111111",
          },
        });
        let hoveredId: string | number | null = null;
        const clearHover = () => {
          if (hoveredId != null) map.setFeatureState({ source: "notices", id: hoveredId }, { hover: false });
          hoveredId = null;
        };
        map.on("click", "notice-ring", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) setSelectedId(id);
        });
        map.on("mousemove", "notice-ring", (e) => {
          map.getCanvas().style.cursor = "pointer";
          const id = e.features?.[0]?.id;
          if (id == null || id === hoveredId) return;
          clearHover();
          hoveredId = id;
          map.setFeatureState({ source: "notices", id: hoveredId }, { hover: true });
        });
        map.on("mouseleave", "notice-ring", () => {
          map.getCanvas().style.cursor = "";
          clearHover();
        });
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // sync visible pins
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource("notices") as GeoJSONSource | undefined)?.setData(toGeoJSON(visible));
  }, [ready, visible]);

  // selection highlight + fly
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (prevSel.current) map.setFeatureState({ source: "notices", id: prevSel.current }, { selected: false });
    if (selected) {
      map.setFeatureState({ source: "notices", id: selected.id }, { selected: true });
      map.easeTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    }
    prevSel.current = selected?.id ?? null;
  }, [ready, selected]);

  return (
    <div className="shell">
      <aside className="panel">
        <header className="masthead">
          <div className="notice-tag">Notice</div>
          <h1>Working Titles</h1>
          <p className="dek">
            Film shoot notices I&rsquo;ve spotted around New York. The name on the sign, and what it really was.
          </p>
        </header>

        <div className="controls">
          <input
            className="search"
            placeholder="Search codenames, titles, streets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="filter"
            aria-label="Filter notices by decode status"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All notices ({counts.all})</option>
            <option value="decoded">Decoded ({counts.decoded})</option>
            <option value="hunch">Hunches ({counts.hunch})</option>
            <option value="unknown">Unknown ({counts.unknown})</option>
          </select>
        </div>

        {selected ? (
          <Detail key={selected.id} notice={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <ul className="list">
            {visible.map((n) => (
              <li key={n.id}>
                <button className="row" onClick={() => setSelectedId(n.id)}>
                  <span className={`dot ${n.status}`} aria-hidden />
                  <span className="row-main">
                    <span className="codename">{n.codename}</span>
                    <span className="real">
                      {n.realTitle ? (
                        <>
                          → {n.realTitle}
                          {n.status === "hunch" && " ?"}
                        </>
                      ) : (
                        <em>undecoded</em>
                      )}
                    </span>
                  </span>
                  <span className="row-meta">
                    {n.borough ?? ""}
                    <br />
                    {n.spottedAt?.slice(0, 4)}
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="empty">Nothing matches.</li>}
          </ul>
        )}

        <footer className="foot">
          <span className="legend" aria-hidden="true">
            <span className="lg lg0" />
            <span className="lg lg1" />
            <span className="lg lg2" />
          </span>
          <span>fill = confidence · {counts.decoded}/{counts.all} decoded</span>
          <a className="src" href="https://github.com/deepcshah/workingtitles">source</a>
        </footer>
      </aside>

      <div ref={mapEl} className="map" />
    </div>
  );
}

function Detail({ notice: n, onBack }: { notice: Notice; onBack: () => void }) {
  return (
    <article className="detail">
      <button className="back" onClick={onBack}>
        ← All notices
      </button>

      {n.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="photo" src={n.photo} alt={`Shoot notice for ${n.codename}`} />
      )}

      <div className="decode">
        <div className="label">On the sign</div>
        <div className="sign">{n.codename}</div>
        {n.match && !n.match.isCodename ? (
          <div className="label straight">Not a codename: filmed under its real title</div>
        ) : (
          <>
            <div className="arrow">↓</div>
            <div className="label">
              Really {n.status === "hunch" && <span className="pill hunch">hunch</span>}
            </div>
            <div className="truth">{n.realTitle ?? <em>Still a mystery</em>}</div>
          </>
        )}
        {(n.kind || n.year) && (
          <div className="sub">{[n.kind && KIND_LABEL[n.kind], n.year].filter(Boolean).join(" · ")}</div>
        )}
        {n.match && (
          <div className="confidence">
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.round(n.match.confidence * 100)}%` }} />
            </div>
            <span>{Math.round(n.match.confidence * 100)}% confident</span>
          </div>
        )}
      </div>

      {n.match && (n.match.reasoning || n.match.sources.length > 0) && (
        <div className="evidence">
          {n.match.reasoning && <p>{n.match.reasoning}</p>}
          {n.match.sources.length > 0 && (
            <ol>
              {n.match.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || new URL(s.url).hostname}
                  </a>
                  <span className="host">{new URL(s.url).hostname.replace(/^www\./, "")}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {(n.imdb || n.letterboxd) && (
        <div className="links">
          {n.letterboxd && (
            <a href={n.letterboxd} target="_blank" rel="noreferrer">
              Letterboxd ↗
            </a>
          )}
          {n.imdb && (
            <a href={n.imdb} target="_blank" rel="noreferrer">
              IMDb ↗
            </a>
          )}
        </div>
      )}

      <dl className="facts">
        {n.place && (
          <>
            <dt>Where</dt>
            <dd>
              {n.place}
              {n.borough && `, ${n.borough}`}
            </dd>
          </>
        )}
        {n.sign?.company && (
          <>
            <dt>Company</dt>
            <dd>{n.sign.company}</dd>
          </>
        )}
        {n.sign?.dates && (
          <>
            <dt>Shooting</dt>
            <dd>{n.sign.dates}</dd>
          </>
        )}
        {n.spottedAt && (
          <>
            <dt>Spotted</dt>
            <dd>{fmtDate(n.spottedAt)}</dd>
          </>
        )}
        {n.notes && (
          <>
            <dt>Notes</dt>
            <dd>{n.notes}</dd>
          </>
        )}
      </dl>
    </article>
  );
}
