"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, GeoJSONSource } from "maplibre-gl";
import type { Kind, Notice, Status } from "@/lib/types";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const NYC: [number, number] = [-73.96, 40.73];

const STATUS_LABEL: Record<Status, string> = {
  decoded: "Decoded",
  hunch: "Hunch",
  unknown: "Unknown",
};

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
      properties: { id: n.id, status: n.status, codename: n.codename },
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
            "circle-color": "#ffd400",
            "circle-opacity": 0.55,
          },
        });
        map.addLayer({
          id: "notice-dot",
          type: "circle",
          source: "notices",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.5, 15, 8],
            "circle-color": [
              "match",
              ["get", "status"],
              "decoded", "#111111",
              "hunch", "#e0a100",
              "#ffffff",
            ],
            "circle-stroke-color": "#111111",
            "circle-stroke-width": 1.75,
          },
        });
        map.on("click", "notice-dot", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) setSelectedId(id);
        });
        map.on("mouseenter", "notice-dot", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "notice-dot", () => (map.getCanvas().style.cursor = ""));
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
          <div className="chips" role="tablist">
            {(["all", "decoded", "hunch", "unknown"] as Filter[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={`chip ${filter === f ? "on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : STATUS_LABEL[f]} <span>{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <Detail notice={selected} onBack={() => setSelectedId(null)} />
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
          {counts.decoded} of {counts.all} decoded · <a href="https://github.com/deepcshah/workingtitles">source</a>
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
        <div className="arrow">↓</div>
        <div className="label">
          Really {n.status === "hunch" && <span className="pill hunch">hunch</span>}
        </div>
        <div className="truth">{n.realTitle ?? <em>Still a mystery</em>}</div>
        {(n.kind || n.year) && (
          <div className="sub">{[n.kind && KIND_LABEL[n.kind], n.year].filter(Boolean).join(" · ")}</div>
        )}
      </div>

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
