"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4100";

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export default function DummyControl() {
  const [status, setStatus] = useState(null);
  const [minSec, setMinSec] = useState(5);
  const [maxSec, setMaxSec] = useState(20);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const s = await fetch(`${API}/api/dummy/status`).then(r => r.json());
      setStatus(s);
      setMinSec(Math.round((s.minMs ?? 5000) / 1000));
      setMaxSec(Math.round((s.maxMs ?? 20000) / 1000));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  async function start() {
    setError("");
    const minMs = clamp(minSec, 5, 20) * 1000;
    const maxMs = clamp(maxSec, 5, 20) * 1000;

    try {
      await fetch(`${API}/api/dummy/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minMs, maxMs }),
      });
      await refresh();
    } catch (e) { setError(String(e)); }
  }

  async function stop() {
    setError("");
    try {
      await fetch(`${API}/api/dummy/stop`, { method: "POST" });
      await refresh();
    } catch (e) { setError(String(e)); }
  }

  async function sendOnce() {
    setError("");
    try {
      await fetch(`${API}/api/dummy/once`, { method: "POST" });
      await refresh();
    } catch (e) { setError(String(e)); }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Dummy Generator Control</h1>
      <p style={{ color: "#666" }}>
        Set sending interval range (random between min–max) and start/stop the generator.
      </p>

      {error && <div style={{ color: "red" }}>Error: {error}</div>}

      <div style={{ marginTop: 16, maxWidth: 520, border: "1px solid #eee", borderRadius: 14, padding: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>Status</div>
            <div style={{ fontWeight: 800 }}>
              {status ? (status.running ? "RUNNING ✅" : "STOPPED ⛔") : "…"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>Sent</div>
            <div style={{ fontWeight: 800 }}>{status ? status.sent : "…"}</div>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "14px 0" }} />

        <label style={{ display: "block", fontSize: 12, color: "#666" }}>
          Min interval: <b>{minSec}s</b>
        </label>
        <input
          type="range"
          min={5}
          max={20}
          value={minSec}
          onChange={(e) => setMinSec(Number(e.target.value))}
          style={{ width: "100%" }}
        />

        <label style={{ display: "block", fontSize: 12, color: "#666", marginTop: 10 }}>
          Max interval: <b>{maxSec}s</b>
        </label>
        <input
          type="range"
          min={5}
          max={20}
          value={maxSec}
          onChange={(e) => setMaxSec(Number(e.target.value))}
          style={{ width: "100%" }}
        />

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={start} style={btnStyle("#111")}>Start</button>
          <button onClick={stop} style={btnStyle("#444")}>Stop</button>
          <button onClick={sendOnce} style={btnStyle("#0b7")}>Send once</button>
          <button onClick={refresh} style={btnStyle("#06c")}>Refresh</button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
          Note: demo-only control endpoints. In production you’d restrict these with auth.
        </div>
      </div>
    </main>
  );
}

function btnStyle(bg) {
  return {
    background: bg,
    color: "white",
    border: "none",
    padding: "10px 12px",
    borderRadius: 10,
    cursor: "pointer",
    fontWeight: 700,
  };
}
