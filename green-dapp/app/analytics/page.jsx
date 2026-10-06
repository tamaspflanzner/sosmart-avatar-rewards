"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "../../lib/useWallet";
import Nav from "../components/Nav";
import { apiGet, fmt } from "../lib/api";

function toTimeLabel(ts, bucket) {
  const d = new Date(ts);
  if (bucket === "hour") return `${String(d.getHours()).padStart(2, "0")}:00`;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const MODE_COLORS = {
  bus: "rgba(34,197,94,.95)",
  rail: "rgba(6,182,212,.95)",
  monorail: "rgba(124,58,237,.95)",
  "park&ride": "rgba(245,158,11,.95)",
};

export default function AnalyticsPage() {
  const { address, isConnected } = useWallet();

  const [scope, setScope] = useState("global"); // global | mine
  const [bucket, setBucket] = useState("hour");
  const [windowSize, setWindowSize] = useState(720);

  const [series, setSeries] = useState(null);
  const [method, setMethod] = useState(null);
  const [modes, setModes] = useState(null);
  const [peak, setPeak] = useState(null);
  const [summary, setSummary] = useState(null);
  const [co2, setCo2] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    setError("");
    try {
      const isMine = scope === "mine";
      if (isMine && (!isConnected || !address)) {
        setSeries(null);
        setModes(null);
        setPeak(null);
        setSummary(null);
        setCo2(null);
        setMethod(await apiGet(`/api/stats/methodology`));
        setError("Connect wallet to view My stats.");
        return;
      }

      const withScope = (path) => {
        if (!isMine) return path;
        const separator = path.includes("?") ? "&" : "?";
        return `${path}${separator}wallet=${encodeURIComponent(address)}`;
      };
      const [s, m, mo, pk, sum, c] = await Promise.all([
        apiGet(withScope(`/api/stats/timeseries?bucket=${bucket}&window=${windowSize}`)),
        apiGet(`/api/stats/methodology`),
        apiGet(withScope(`/api/stats/modes`)),
        apiGet(withScope(`/api/stats/peak-hours`)),
        apiGet(withScope(`/api/stats/summary`)),
        apiGet(withScope(`/api/stats/co2`)),
      ]);

      setSeries(s);
      setMethod(m);
      setModes(mo);
      setPeak(pk);
      setSummary(sum);
      setCo2(c);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load({ silent: true }), 5000);
    return () => clearInterval(t);
  }, [bucket, windowSize, scope, address, isConnected]);

  const points = series?.points || [];
  const labels = useMemo(() => points.map((p) => toTimeLabel(p.t, bucket)), [points, bucket]);

  const totals = useMemo(() => {
    let trips = 0;
    let dist = 0;
    let co2Saved = 0;
    for (const p of points) {
      trips += Number(p.trips || 0);
      dist += Number(p.distanceKm || 0);
      co2Saved += Number(p.co2SavedKg || 0);
    }
    return {
      trips,
      dist: Number(dist.toFixed(2)),
      co2: Number(co2Saved.toFixed(3)),
    };
  }, [points]);

  const modeShare = useMemo(() => {
    const pct = modes?.modeShareTripsPct || {};
    return [
      { key: "bus", label: "Bus", value: pct.bus ?? 0 },
      { key: "rail", label: "Rail", value: pct.rail ?? 0 },
      { key: "monorail", label: "Monorail", value: pct.monorail ?? 0 },
      { key: "park&ride", label: "Park&Ride", value: pct["park&ride"] ?? 0 },
    ];
  }, [modes]);

  const tripsByType = modes?.tripsByType || {};
  const distanceByType = modes?.distanceByTypeKm || {};
  const co2ByType = modes?.co2SavedByTypeKg || {};

  const peakTrips = peak?.tripsByHour || Array(24).fill(0);
  const hasWindowData = points.some(
    (p) => Number(p?.trips || 0) > 0 || Number(p?.distanceKm || 0) > 0 || Number(p?.co2SavedKg || 0) > 0
  );
  const hasAnyData = Number(summary?.totalTrips || 0) > 0;

  return (
    <div className="shell">
      <Nav />

      <div className="topbar">
        <div className="title">
          <h1 className="h1">Analytics</h1>
          <p className="subtitle">
            {scope === "mine"
              ? "My wallet analytics: time-series, mode split, peak hours, and methodology."
              : "Global analytics: time-series, mode split, peak hours, and methodology (DB-backed API)."}
          </p>
        </div>

        <div className="pills">
          <div className="pill" style={{ padding: 6 }}>
            <div style={scopeSwitchWrap}>
              <div
                style={{
                  ...scopeSwitchThumb,
                  transform: scope === "mine" ? "translateX(100%)" : "translateX(0%)",
                }}
              />
              <button onClick={() => setScope("global")} style={scopeSwitchBtn(scope === "global")} type="button">
                Global
              </button>
              <button onClick={() => setScope("mine")} style={scopeSwitchBtn(scope === "mine")} type="button">
                My stats
              </button>
            </div>
          </div>

          <div className="pill">
            Bucket:
            <select value={bucket} onChange={(e) => setBucket(e.target.value)} style={selectStyle}>
              <option value="minute">minute</option>
              <option value="hour">hour</option>
            </select>
          </div>

          <div className="pill">
            Window:
            <select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} style={selectStyle}>
              {bucket === "minute" ? (
                <>
                  <option value={15}>15</option>
                  <option value={60}>60</option>
                  <option value={120}>120</option>
                  <option value={360}>360</option>
                  <option value={720}>720</option>
                  <option value={1440}>1440</option>
                </>
              ) : (
                <>
                  <option value={6}>6</option>
                  <option value={24}>24</option>
                  <option value={72}>72</option>
                  <option value={168}>168</option>
                  <option value={336}>336</option>
                  <option value={720}>720</option>
                </>
              )}
            </select>
          </div>

          <button onClick={() => load()} className="pill" style={pillBtn}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="error">Error: {error}</div>}
      {!loading && !error && !hasAnyData && (
        <div
          className="error"
          style={{ borderColor: "rgba(56,189,248,.35)", background: "rgba(56,189,248,.10)" }}
        >
          No events found for the selected scope yet.
        </div>
      )}

      <div className="grid">
        <MetricCard
          colSpan={3}
          accent="cyan"
          title={scope === "mine" ? "Total trips (me)" : "Total trips"}
          value={loading && !summary ? "..." : fmt(summary?.totalTrips, 0)}
          unit="trips"
          badge={scope === "mine" ? "wallet total" : "all events"}
        />
        <MetricCard
          colSpan={3}
          accent="green"
          title="Total distance"
          value={loading && !summary ? "..." : fmt(summary?.totalDistanceKm, 2)}
          unit="km"
          badge="sum"
        />
        <MetricCard
          colSpan={3}
          accent="amber"
          title="CO2 saved"
          value={loading && !co2 ? "..." : fmt(co2?.savedCO2_kg, 3)}
          unit="kg"
          badge="estimate"
        />
        <MetricCard
          colSpan={3}
          accent=""
          title="Trips (selected window)"
          value={loading && !series ? "..." : fmt(totals.trips, 0)}
          unit="trips"
          badge="sum buckets"
        />

        {/* Trips over time */}
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent" />
          <div className="card-inner">
            <div className="section-title">
              Trips over time <span className="hint">(count per bucket)</span>
            </div>
            {hasWindowData ? (
              <Sparkline
                labels={labels}
                values={points.map((p) => p.trips)}
                height={160}
                formatY={(v) => fmt(v, 0)}
              />
            ) : (
              <EmptyChartNote text="No trip data in this selected window." />
            )}
          </div>
        </div>

        {/* CO2 timeseries */}
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent cyan" />
          <div className="card-inner">
            <div className="section-title">
              CO₂ saved over time <span className="hint">(kg per bucket)</span>
            </div>
            {hasWindowData ? (
              <Sparkline
                labels={labels}
                values={points.map((p) => p.co2SavedKg)}
                height={160}
                formatY={(v) => fmt(v, 3)}
              />
            ) : (
              <EmptyChartNote text="No CO2 data in this selected window." />
            )}
          </div>
        </div>

        {/* Mode share donut */}
        <div className="card" style={{ gridColumn: "span 5" }}>
          <div className="accent green" />
          <div className="card-inner">
            <div className="section-title">
              Mode share <span className="hint">(trips %)</span>
            </div>

            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <Donut segments={modeShare} colors={MODE_COLORS} size={180} />

              <div style={{ display: "grid", gap: 10 }}>
                {modeShare.map((s) => (
                  <LegendRow
                    key={s.key}
                    color={MODE_COLORS[s.key]}
                    label={s.label}
                    value={`${fmt(s.value, 1)}%`}
                  />
                ))}
                <div className="small">Based on total trips from DB events.</div>
              </div>
            </div>
          </div>
        </div>

        {/* Peak hours */}
        <div className="card" style={{ gridColumn: "span 7" }}>
          <div className="accent amber" />
          <div className="card-inner">
            <div className="section-title">
              Peak hours <span className="hint">(trips by hour)</span>
            </div>
            <Bars24 values={peakTrips} height={210} />
            <div className="small" style={{ marginTop: 8 }}>
              Useful for discussing off-peak incentives and commute patterns.
            </div>
          </div>
        </div>

        {/* Mode details table */}
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent cyan" />
          <div className="card-inner">
            <div className="section-title">
              Mode breakdown details <span className="hint">(trips / distance / CO₂)</span>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th className="right">Trips</th>
                    <th className="right">Share (%)</th>
                    <th className="right">Distance (km)</th>
                    <th className="right">CO₂ saved (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {["bus", "rail", "monorail", "park&ride"].map((k) => (
                    <tr key={k}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`chip ${k === "park&ride" ? "parkride" : k}`} />
                          <span>{k}</span>
                        </div>
                      </td>
                      <td className="right">{fmt(tripsByType[k] ?? 0, 0)}</td>
                      <td className="right">{fmt(modes?.modeShareTripsPct?.[k] ?? 0, 1)}</td>
                      <td className="right">{fmt(distanceByType[k] ?? 0, 2)}</td>
                      <td className="right">{fmt(co2ByType[k] ?? 0, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="small" style={{ marginTop: 8 }}>
              Totals cross-check: overall CO₂ estimate = <span className="mono">{fmt(co2?.savedCO2_kg, 3)} kg</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, unit, badge, accent = "", colSpan = 4 }) {
  const span = `span ${colSpan}`;
  return (
    <div className="card" style={{ gridColumn: span }}>
      <div className={`accent ${accent}`} />
      <div className="card-inner">
        <div className="card-header">
          <div className="card-title">{title}</div>
          <div className="badge">{badge}</div>
        </div>
        <div className="metric">
          <div className="metric-value">{value}</div>
          <div className="metric-unit">{unit}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyChartNote({ text }) {
  return (
    <div
      style={{
        marginTop: 10,
        border: "1px dashed var(--ui-soft-border)",
        borderRadius: 12,
        padding: "18px 14px",
        color: "var(--muted)",
        background: "color-mix(in srgb, var(--ui-soft-bg) 55%, transparent)",
      }}
    >
      {text}
    </div>
  );
}

/* ---------- Charts (simple SVG, no libs) ---------- */

function Sparkline({ values, labels, height = 140, formatY }) {
  const width = 1000;
  const pad = 26;

  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(1, ...nums);
  const min = Math.min(0, ...nums);

  const pts = nums.map((v, i) => {
    const x = pad + (i * (width - 2 * pad)) / Math.max(1, nums.length - 1);
    const norm = (v - min) / Math.max(1e-9, (max - min));
    const y = pad + (1 - norm) * (height - 2 * pad);
    return { x, y, v };
  });

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1];

  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--chart-axis)" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="var(--chart-axis)" />

        {pts.length > 0 && (
          <>
            <path d={`${d} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`} fill="var(--chart-fill)" />
            <path d={d} fill="none" stroke="var(--chart-line)" strokeWidth="2.2" />
          </>
        )}

        {last && <circle cx={last.x} cy={last.y} r="4.5" fill="var(--chart-point)" />}
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <div className="small">
          min: <span className="mono">{formatY ? formatY(min) : min}</span> · max:{" "}
          <span className="mono">{formatY ? formatY(max) : max}</span>
        </div>
        <div className="small">
          last:{" "}
          <span className="mono">
            {formatY ? formatY(values[values.length - 1] ?? 0) : (values[values.length - 1] ?? 0)}
          </span>
        </div>
      </div>

      <div className="small" style={{ marginTop: 6 }}>
        {labels?.length ? (
          <>
            <span className="mono">{labels[0]}</span> → <span className="mono">{labels[labels.length - 1]}</span>
          </>
        ) : (
          "No labels"
        )}
      </div>
    </div>
  );
}

function Donut({ segments, colors, size = 180 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const stroke = size * 0.12;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} stroke="var(--chart-axis)" strokeWidth={stroke} fill="none" />

      {segments.map((s) => {
        const pct = Math.max(0, Number(s.value) || 0);
        const len = (pct / 100) * C;
        const dasharray = `${len} ${C - len}`;
        const dashoffset = -offset;
        offset += len;

        return (
          <circle
            key={s.key}
            cx={cx}
            cy={cy}
            r={r}
            stroke={colors[s.key] || "var(--chart-line)"}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={dasharray}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
      })}

      <text x={cx} y={cy - 2} textAnchor="middle" fill="var(--text)" fontSize={14} fontWeight={800}>
        Trips
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--muted)" fontSize={11}>
        share
      </text>
    </svg>
  );
}

function LegendRow({ color, label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: color,
          boxShadow: `0 0 0 4px color-mix(in srgb, var(--ui-soft-bg) 60%, transparent)`,
        }}
      />
      <div style={{ minWidth: 90 }}>{label}</div>
      <div className="mono" style={{ color: "var(--mono)" }}>{value}</div>
    </div>
  );
}

function Bars24({ values, height = 180 }) {
  const width = 1000;
  const pad = 26;
  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(1, ...nums);
  const barW = (width - 2 * pad) / 24;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="var(--chart-axis)" />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="var(--chart-axis)" />

      {nums.map((val, i) => {
        const h = ((height - 2 * pad) * val) / max;
        const x = pad + i * barW + 2;
        const y = height - pad - h;
        const w = barW - 4;

        return <rect key={i} x={x} y={y} width={w} height={h} rx={6} fill="var(--chart-line)" opacity={0.9} />;
      })}

      {[0, 6, 12, 18, 23].map((h) => {
        const x = pad + h * barW + barW / 2;
        return (
          <text key={h} x={x} y={height - 8} textAnchor="middle" fill="var(--chart-label)" fontSize="11">
            {h}
          </text>
        );
      })}
    </svg>
  );
}

const selectStyle = {
  marginLeft: 8,
  background: "var(--ui-soft-bg)",
  color: "var(--ui-soft-text)",
  border: "1px solid var(--ui-soft-border)",
  borderRadius: 10,
  padding: "6px 8px",
  outline: "none",
};

const scopeSwitchWrap = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  alignItems: "center",
  width: 220,
  borderRadius: 999,
  border: "1px solid var(--ui-soft-border)",
  background: "var(--ui-soft-bg)",
  padding: 3,
  overflow: "hidden",
};

const scopeSwitchThumb = {
  position: "absolute",
  inset: 3,
  width: "calc(50% - 3px)",
  borderRadius: 999,
  background: "linear-gradient(90deg, rgba(6,182,212,.38), rgba(124,58,237,.32))",
  border: "1px solid var(--ui-soft-border)",
  transition: "transform 180ms ease",
  pointerEvents: "none",
};

const scopeSwitchBtn = (active) => ({
  position: "relative",
  zIndex: 1,
  border: "none",
  background: "transparent",
  color: active ? "var(--text)" : "var(--muted)",
  fontWeight: active ? 900 : 700,
  padding: "8px 12px",
  borderRadius: 999,
  cursor: "pointer",
});

const pillBtn = {
  border: "1px solid var(--ui-soft-border)",
  background: "var(--ui-soft-bg)",
  color: "var(--ui-soft-text)",
  cursor: "pointer",
};

