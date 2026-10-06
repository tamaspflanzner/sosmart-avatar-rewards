"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDisconnect } from "wagmi";
import { useWallet } from "../../lib/useWallet";
import Nav from "../components/Nav";
import ClaimOnChainButton from "../../components/ClaimOnChainButton";
import AvatarShowcase from "../components/AvatarShowcase";

const API =
  typeof window !== "undefined"
    ? "/api-proxy"
    : process.env.NEXT_PUBLIC_GREEN_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4100";

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

function fmt(n, digits = 3) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtDate(v) {
  if (!v) return "-";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return String(v);
  return d.toLocaleString();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`API did not return JSON (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.details
      ? `${json.error || "Request failed"} | ${typeof json.details === "string" ? json.details : JSON.stringify(json.details)}`
      : json?.error || "Request failed";
    throw new Error(msg);
  }

  return json;
}

export default function ProfilePage() {
  const { address, isConnected, isEmbedded, embeddedEmail, logoutEmbedded } = useWallet();
  const { disconnect } = useDisconnect();

  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState(null);
  const [claimPreview, setClaimPreview] = useState(null);
  const [claims, setClaims] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [avatarLayout, setAvatarLayout] = useState(null);

  const [claimAmount, setClaimAmount] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrMessage, setQrMessage] = useState("");

  useEffect(() => setMounted(true), []);

  async function loadAll(addr, { silent = false } = {}) {
    if (!silent) {
      setErr("");
      setInfo("");
      setData(null);
      setClaimPreview(null);
      setClaims([]);
      setPurchases([]);
      setAvatarLayout(null);
    } else {
      setRefreshing(true);
    }

    try {
      const [rewardsJson, previewJson, claimsJson, purchasesJson, avatarJson] = await Promise.all([
        fetchJson(`${API}/api/users/${addr}/rewards`, { cache: "no-store" }),
        fetchJson(`${API}/api/users/${addr}/claim-preview`, { cache: "no-store" }),
        fetchJson(`${API}/api/users/${addr}/claims`, { cache: "no-store" }),
        fetchJson(`${API}/api/users/${addr}/purchases`, { cache: "no-store" }),
        fetchJson(`${API}/api/avatar-layout/${addr}`, { cache: "no-store" }),
      ]);

      setData(rewardsJson);
      setClaimPreview(previewJson);
      setClaims(Array.isArray(claimsJson?.claims) ? claimsJson.claims : []);
      setPurchases(Array.isArray(purchasesJson?.purchases) ? purchasesJson.purchases : []);
      setAvatarLayout(avatarJson?.layout || null);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  }

  async function createClaim() {
    setErr("");
    setInfo("");

    if (!isConnected || !address) {
      setErr("Connect wallet first.");
      return;
    }

    const amount = Number(claimAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Enter a valid positive claim amount.");
      return;
    }

    if (data?.claimableTokens != null && amount > Number(data.claimableTokens)) {
      setErr(`Requested amount exceeds claimable balance (${data.claimableTokens}).`);
      return;
    }

    try {
      setClaimLoading(true);

      const json = await fetchJson(`${API}/api/users/${address}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountTokens: amount }),
      });

      setInfo(`Claim created: ${json.amountTokens} ${data?.token || "GCT"} (status: ${json.claimStatus})`);
      setClaimAmount("");

      await loadAll(address, { silent: true });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setClaimLoading(false);
    }
  }

  useEffect(() => {
    if (mounted && isConnected && address) loadAll(address);
  }, [mounted, isConnected, address]);

  function handleDisconnect() {
    if (isEmbedded) {
      logoutEmbedded();
    } else {
      disconnect();
    }
    setData(null);
    setClaimPreview(null);
    setClaims([]);
    setPurchases([]);
    setAvatarLayout(null);
    setClaimAmount("");
    setErr("");
    setInfo("");
  }

  const tokenSymbol = data?.token || "GCT";
  const displayName = mounted
    ? isConnected && address
      ? isEmbedded && embeddedEmail
        ? embeddedEmail
        : shortAddr(address)
      : "Not connected"
    : "Loading wallet...";

  const qrInviteUrl =
    mounted && isConnected && address && typeof window !== "undefined"
      ? `${window.location.origin}/community?addFriend=${address.toLowerCase()}`
      : "";

  const qrImageUrl = useMemo(
    () =>
      qrInviteUrl
        ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qrInviteUrl)}`
        : "",
    [qrInviteUrl]
  );

  async function copyQrInviteUrl() {
    if (!qrInviteUrl) return;
    try {
      await navigator.clipboard.writeText(qrInviteUrl);
      setQrMessage("Friend QR link copied.");
    } catch {
      setQrMessage(qrInviteUrl);
    }
  }

  const activityFeed = useMemo(() => {
    const items = [
      ...claims.map((c) => ({
        type: "claim",
        id: `claim-${c.id}`,
        label: `Claimed ${fmt(c.amountTokens, 2)} ${tokenSymbol}`,
        sub: c.claimStatus,
        date: c.createdAt,
        accent: "#34d399",
        raw: c,
      })),
      ...purchases.map((p) => ({
        type: "purchase",
        id: `purchase-${p.id}`,
        label: `Bought ${p.itemName || p.itemId}`,
        sub: p.slotName || p.purchaseMode || "shop",
        date: p.createdAt,
        accent: "#fbbf24",
        raw: p,
      })),
    ];
    return items.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [claims, purchases, tokenSymbol]);

  const claimablePercent = useMemo(() => {
    const earned = Number(data?.earnedTokens || 0);
    const claimed = Number(data?.claimedTokens || 0);
    if (!earned) return 0;
    return Math.min(100, Math.round((claimed / earned) * 100));
  }, [data]);

  return (
    <div className="shell">
      <Nav />

      <div className="profile-hero">
        <div className="profile-hero-avatar">
          <AvatarShowcase layout={avatarLayout} size={220} rounded={22} />
          <div className="profile-hero-avatar-actions">
            <Link href="/avatar" className="pill" style={linkBtn}>Edit avatar</Link>
            {mounted && isConnected && address ? (
              <Link href={`/community/${address.toLowerCase()}`} className="pill" style={linkBtn}>Public profile</Link>
            ) : null}
          </div>
        </div>

        <div className="profile-hero-info">
          <div className="profile-hero-address">
            {mounted && isConnected && address ? (
              <>
                <span className="profile-hero-addr-short">{displayName}</span>
                <span className="profile-hero-addr-full mono">{address}</span>
              </>
            ) : (
              <span className="profile-hero-addr-short">Not connected</span>
            )}
          </div>

          <div className="profile-hero-stats">
            <div className="profile-stat">
              <div className="profile-stat-value">{isConnected && data ? fmt(data.earnedTokens, 2) : "-"}</div>
              <div className="profile-stat-label">GCT earned</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-value">{isConnected && data ? fmt(data.spendableTokensOnChain, 2) : "-"}</div>
              <div className="profile-stat-label">on-chain</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-value">{isConnected && data ? fmt(data.eventsCount, 0) : "-"}</div>
              <div className="profile-stat-label">trips</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-value">{isConnected && data ? fmt(data.breakdown?.co2SavedKg, 1) : "-"}</div>
              <div className="profile-stat-label">kg CO2 saved</div>
            </div>
          </div>

          {isConnected && data ? (
            <div className="profile-progress-wrap">
              <div className="profile-progress-labels">
                <span>Claimed {fmt(data.claimedTokens, 2)} {tokenSymbol}</span>
                <span>{claimablePercent}% of earned</span>
              </div>
              <div className="profile-progress-track">
                <div className="profile-progress-fill" style={{ width: `${claimablePercent}%` }} />
              </div>
              <div className="profile-progress-labels" style={{ marginTop: 4 }}>
                <span style={{ color: "rgba(52,211,153,.9)", fontWeight: 700 }}>
                  {fmt(data.claimableTokens, 2)} {tokenSymbol} claimable
                </span>
                <span>{fmt(data.breakdown?.distanceKm, 1)} km total</span>
              </div>
            </div>
          ) : null}

          <div className="profile-hero-actions">
            {!mounted ? null : isConnected ? (
              <>
                <button onClick={() => loadAll(address, { silent: true })} style={btnStyle}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button onClick={handleDisconnect} style={btnStyle2}>
                  Disconnect
                </button>
              </>
            ) : null}
          </div>

          {err ? <div className="error" style={{ marginTop: 10 }}>Error: {err}</div> : null}
          {info ? <div className="profile-info-msg">{info}</div> : null}
        </div>

        {mounted && isConnected && address ? (
          <div className="profile-hero-qr">
            <div className="profile-hero-qr-meta">
              <div className="profile-qr-label">Friend QR</div>
              <div className="small">Open this from another phone to add this wallet faster.</div>
              <button onClick={copyQrInviteUrl} style={{ ...btnStyle, fontSize: 12, padding: "7px 12px", marginTop: 8 }}>
                Copy invite link
              </button>
              {qrMessage ? <div className="small" style={{ marginTop: 6 }}>{qrMessage}</div> : null}
            </div>
            <img src={qrImageUrl} alt="Friend invite QR" className="profile-qr-img" />
          </div>
        ) : null}
      </div>

      <div className="grid">
        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent green" />
          <div className="card-inner">
            <div className="section-title">Claim GCT <span className="hint">on-chain flow</span></div>
            {!mounted || !isConnected ? (
              <div className="small">Connect wallet first.</div>
            ) : (
              <div className="profile-claim-row">
                <div className="profile-claim-preview">
                  <div className="profile-claim-amount">{claimPreview ? fmt(claimPreview.claimableTokens, 2) : "-"}</div>
                  <div className="small">claimable {tokenSymbol}</div>
                </div>
                <div className="profile-claim-form">
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={claimAmount}
                    onChange={(e) => setClaimAmount(e.target.value)}
                    placeholder={`e.g. ${data?.claimableTokens || 10}`}
                    style={{ ...inputStyle, flex: 1, minWidth: 140 }}
                  />
                  <button onClick={createClaim} disabled={claimLoading} style={btnStyle}>
                    {claimLoading ? "Creating..." : "Create Claim"}
                  </button>
                </div>
                <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
                  After creating, use &quot;Claim on-chain&quot; in the history below.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card" style={{ gridColumn: "span 12" }}>
          <div className="accent cyan" />
          <div className="card-inner">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Activity feed</div>
              <div style={{ display: "flex", gap: 8 }}>
                <span className="badge" style={{ background: "rgba(52,211,153,.12)", color: "#34d399" }}>Claims</span>
                <span className="badge" style={{ background: "rgba(251,191,36,.12)", color: "#fbbf24" }}>Purchases</span>
              </div>
            </div>

            {!mounted || !isConnected ? (
              <div className="small" style={{ marginTop: 14 }}>Connect wallet first.</div>
            ) : activityFeed.length === 0 ? (
              <div className="small" style={{ marginTop: 14 }}>No activity yet.</div>
            ) : (
              <div className="activity-feed">
                {activityFeed.map((item) => {
                  const isSubmittedClaim = item.type === "claim" && item.raw?.claimStatus === "submitted";
                  return (
                    <div key={item.id} className="activity-item">
                      <div className="activity-dot" style={{ background: item.accent }} />
                      <div className="activity-body">
                        <div className="activity-label">{item.label}</div>
                        <div className="activity-sub">{item.sub}</div>
                      </div>
                      <div className="activity-right">
                        <div className="activity-date">{fmtDate(item.date)}</div>
                        {isSubmittedClaim ? (
                          <ClaimOnChainButton
                            claim={item.raw}
                            onDone={async () => {
                              setInfo(`Claim #${item.raw.id} confirmed on-chain.`);
                              if (address) await loadAll(address, { silent: true });
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: "rgba(255,255,255,.08)",
  color: "rgba(255,255,255,.92)",
  border: "1px solid rgba(255,255,255,.14)",
  padding: "10px 12px",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 800,
};

const btnStyle2 = {
  ...btnStyle,
  background: "rgba(255,255,255,.04)",
  color: "rgba(255,255,255,.70)",
};

const inputStyle = {
  background: "rgba(255,255,255,.06)",
  color: "rgba(255,255,255,.92)",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 12,
  padding: "10px 12px",
  outline: "none",
  minWidth: 180,
};

const linkBtn = {
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
