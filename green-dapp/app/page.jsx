"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AvatarShowcase from "./components/AvatarShowcase";
import Nav from "./components/Nav";
import { apiGet, communityName, fmt, shortAddr } from "./lib/api";

export default function Home() {
  const [summary, setSummary] = useState(null);
  const [co2, setCo2] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [modes, setModes] = useState(null);
  const [recentEvents, setRecentEvents] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    setError("");
    try {
      const [s, c, l, m, e] = await Promise.all([
        apiGet("/api/stats/summary"),
        apiGet("/api/stats/co2"),
        apiGet("/api/stats/leaderboard"),
        apiGet("/api/stats/modes"),
        apiGet("/api/events?limit=8"),
      ]);

      setSummary(s);
      setCo2(c);
      setLeaderboard(l);
      setModes(m);
      setRecentEvents(e);
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
  }, []);

  const byType = summary?.tripsByType || {};
  const top = leaderboard?.top || [];
  const events = recentEvents?.events || [];

  const modeCards = useMemo(() => {
    const trips = modes?.tripsByType || byType || {};
    const pct = modes?.modeShareTripsPct || {};
    return [
      { key: "bus", label: "Bus", count: trips.bus ?? 0, pct: pct.bus ?? 0, chip: "bus" },
      { key: "rail", label: "Rail", count: trips.rail ?? 0, pct: pct.rail ?? 0, chip: "rail" },
      { key: "monorail", label: "Monorail", count: trips.monorail ?? 0, pct: pct.monorail ?? 0, chip: "monorail" },
      { key: "park&ride", label: "Park&Ride", count: trips["park&ride"] ?? 0, pct: pct["park&ride"] ?? 0, chip: "parkride" },
    ];
  }, [modes, byType]);

  return (
    <div className="shell">
      <Nav />

      <div className="topbar">
        <div className="title">
          <h1 className="h1">Green Commute Dashboard</h1>
          <p className="subtitle">
            MySQL-backed live statistics from dummy commute events. Auto-refresh every 5s.
          </p>
        </div>

        <div className="pills" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => load()} className="pill" style={pillBtn}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <div className="pill">CO₂ model: estimate</div>
        </div>
      </div>

      {error && <div className="error">Error: {error}</div>}

      <div className="grid">
        <MetricCard
          colSpan={3}
          accent="cyan"
          title="Total trips"
          value={loading && !summary ? "…" : fmt(summary?.totalTrips, 0)}
          unit="trips"
          badge="all events"
        />
        <MetricCard
          colSpan={3}
          accent="green"
          title="Total distance"
          value={loading && !summary ? "…" : fmt(summary?.totalDistanceKm, 2)}
          unit="km"
          badge="sum"
        />
        <MetricCard
          colSpan={3}
          accent="amber"
          title="CO₂ saved"
          value={loading && !co2 ? "…" : fmt(co2?.savedCO2_kg, 3)}
          unit="kg"
          badge="estimate"
        />
        <MetricCard
          colSpan={3}
          accent=""
          title="CO₂ saved"
          value={loading && !co2 ? "…" : fmt(co2?.savedCO2_tons, 6)}
          unit="tons"
          badge="scientific view"
        />

        {/* Mode breakdown quick cards */}
        <div className="card" style={{ gridColumn: "span 6" }}>
          <div className="accent green" />
          <div className="card-inner">
            <div className="section-title">
              Transport modes <span className="hint">count + share</span>
            </div>

            <div className="kv">
              {modeCards.map((m) => (
                <div key={m.key} className="kv-item">
                  <div className="kv-left">
                    <span className={`chip ${m.chip}`} />
                    <span className="kv-label">{m.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span className="small mono">{fmt(m.pct, 1)}%</span>
                    <span className="kv-value">{fmt(m.count, 0)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="small" style={{ marginTop: 8 }}>
              Based on DB events aggregated by <span className="mono">/api/stats/modes</span>.
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="card" style={{ gridColumn: "span 6" }}>
          <div className="accent cyan" />
          <div className="card-inner">
            <div className="section-title">
              Leaderboard <span className="hint">top distance + avatars</span>
            </div>

            {top.length === 0 ? (
              <div className="small" style={{ marginTop: 14 }}>
                {loading ? "Loading…" : "No data yet"}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                {top.slice(0, 3).map((u, i) => (
                  <Link
                    key={`${u.walletAddress}-${i}`}
                    href={`/community/${u.walletAddress}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "88px 1fr",
                        gap: 12,
                        alignItems: "center",
                        padding: 12,
                        borderRadius: 18,
                        border: "1px solid rgba(255,255,255,.08)",
                        background: "rgba(255,255,255,.03)",
                      }}
                    >
                      <AvatarShowcase layout={u.avatar?.layout} size={88} rounded={18} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ fontWeight: 900 }}>#{i + 1} {communityName(u.customDisplayName, u.walletAddress)}</div>
                          <div className="small">{fmt(u.distanceKm, 2)} km</div>
                        </div>
                        <div className="small" style={{ marginTop: 6 }}>
                          <span className="mono">{shortAddr(u.walletAddress)}</span> · {fmt(u.trips, 0)} trips
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="small" style={{ marginTop: 10 }}>
              <Link href="/community" style={{ color: "inherit" }}>Open full community leaderboard</Link>
            </div>
          </div>
        </div>

        {/* Recent events */}
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent" />
          <div className="card-inner">
            <div className="section-title">
              Recent events <span className="hint">latest ingested commute records</span>
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Wallet</th>
                    <th>Mode</th>
                    <th className="right">Distance (km)</th>
                    <th>Route</th>
                    <th>Stop</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="small">
                        {loading ? "Loading…" : "No events yet"}
                      </td>
                    </tr>
                  ) : (
                    events.map((e) => (
                      <tr key={e.id}>
                        <td className="small">
                          {e.ts ? new Date(e.ts).toLocaleTimeString() : "—"}
                        </td>
                        <td className="mono" title={e.walletAddress}>
                          {shortAddr(e.walletAddress)}
                        </td>
                        <td>{e.tripType}</td>
                        <td className="right">{fmt(e.distanceKm, 2)}</td>
                        <td className="mono">{e.routeId || "—"}</td>
                        <td className="mono">{e.stopId || "—"}</td>
                        <td className="small">{e.source || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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

const pillBtn = {
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(255,255,255,.06)",
  color: "rgba(255,255,255,.92)",
  cursor: "pointer",
};
