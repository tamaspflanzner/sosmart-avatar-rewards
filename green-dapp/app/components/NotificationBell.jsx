"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../../lib/useWallet";
import { API } from "../lib/api";

const TYPE_ROUTES = {
  friend_request: "/community?section=social",
  group_invite: "/community?section=social",
  group_challenge: "/community?section=groups",
  crown_claimed: "/community?section=groups",
  trade_offer: "/shop",
  trade_accepted: "/shop",
  trade_rejected: "/shop",
};

function timeAgo(isoString) {
  if (!isoString) return "";
  const ts = new Date(isoString).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function storageKey(address) {
  return `gc_notifs_seen_${String(address || "").toLowerCase()}`;
}

function getLastSeenId(address) {
  try {
    return Number(localStorage.getItem(storageKey(address)) || 0);
  } catch {
    return 0;
  }
}

function setLastSeenId(address, id) {
  try {
    localStorage.setItem(storageKey(address), String(id));
  } catch {}
}

export default function NotificationBell() {
  const { isConnected, address } = useWallet();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [seenCutoffId, setSeenCutoffId] = useState(0);
  const dropdownRef = useRef(null);
  const pollRef = useRef(null);
  const lastSeenId = useRef(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function updateViewportMode() {
      setIsMobileViewport(window.innerWidth <= 768);
    }

    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);

  useEffect(() => {
    const nextSeenId = address ? getLastSeenId(address) : 0;
    lastSeenId.current = nextSeenId;
    const frame = window.requestAnimationFrame(() => setSeenCutoffId(nextSeenId));
    return () => window.cancelAnimationFrame(frame);
  }, [address]);

  const fetchNotifications = useCallback(async () => {
    if (!isConnected || !address) {
      setNotifications([]);
      setUnread(0);
      return;
    }

    try {
      const res = await fetch(`${API}/api/users/${address}/notifications?limit=20`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = data.notifications ?? [];
      setNotifications(list);
      setUnread(list.filter((n) => n.id > lastSeenId.current).length);
    } catch {
      // silently ignore
    }
  }, [isConnected, address]);

  useEffect(() => {
    const start = window.setTimeout(() => {
      fetchNotifications();
    }, 0);
    pollRef.current = window.setInterval(fetchNotifications, 15000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(pollRef.current);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    if (!open) return;

    function handleOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  async function markAllSeen() {
    if (!address || notifications.length === 0) return;
    const maxId = Math.max(...notifications.map((n) => n.id));
    lastSeenId.current = maxId;
    setSeenCutoffId(maxId);
    setLastSeenId(address, maxId);
    setUnread(0);
    fetch(`${API}/api/users/${address}/notifications/read-all`, { method: "PATCH" }).catch(() => {});
  }

  async function handleBellClick() {
    const next = !open;
    setOpen(next);
    if (next && address && notifications.length > 0) {
      const maxId = Math.max(...notifications.map((n) => n.id));
      if (maxId > lastSeenId.current) {
        lastSeenId.current = maxId;
        setSeenCutoffId(maxId);
        setLastSeenId(address, maxId);
        setUnread(0);
        fetch(`${API}/api/users/${address}/notifications/read-all`, { method: "PATCH" }).catch(() => {});
      }
    }
  }

  async function deleteNotification(notifId) {
    if (!address || !Number.isFinite(Number(notifId))) return;

    const deletedWasUnread = notifications.some((n) => n.id === notifId && n.id > seenCutoffId);

    try {
      await fetch(`${API}/api/users/${address}/notifications/${notifId}`, {
        method: "DELETE",
      });
      setNotifications((prev) => prev.filter((n) => n.id !== notifId));
      if (deletedWasUnread) {
        setUnread((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // silently ignore
    }
  }

  function handleNotifClick(notif) {
    setOpen(false);
    if (notif.id > lastSeenId.current) {
      lastSeenId.current = notif.id;
      setSeenCutoffId(notif.id);
      setLastSeenId(address, notif.id);
      setUnread((prev) => Math.max(0, prev - 1));
      fetch(`${API}/api/users/${address}/notifications/${notif.id}/read`, { method: "PATCH" }).catch(() => {});
    }
    const route = TYPE_ROUTES[notif.type] ?? TYPE_ROUTES[notif.refType] ?? "/community";
    router.push(route);
  }

  if (!mounted || !isConnected) return null;

  const resolvedDropdownStyle = isMobileViewport
    ? {
        ...dropdownStyle,
        position: "fixed",
        top: 78,
        left: 12,
        right: 12,
        width: "auto",
        maxWidth: "none",
      }
    : dropdownStyle;

  return (
    <div ref={dropdownRef} style={containerStyle}>
      <button
        type="button"
        onClick={handleBellClick}
        title="Notifications"
        style={bellBtnStyle}
        className="nav-link"
      >
        <BellIcon />
        {unread > 0 && <span style={badgeStyle}>{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div style={resolvedDropdownStyle}>
          <div style={dropdownHeaderStyle}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
            {notifications.length > 0 && (
              <button type="button" onClick={markAllSeen} style={markAllBtnStyle}>
                Mark all read
              </button>
            )}
          </div>

          <div style={listStyle}>
            {notifications.length === 0 ? (
              <div style={emptyStyle}>No notifications</div>
            ) : (
              notifications.map((n) => {
                const isSeen = n.id <= seenCutoffId;
                return (
                  <div
                    key={n.id}
                    style={{
                      ...notifRowStyle,
                      background: isSeen ? "rgba(255,255,255,.03)" : "rgba(124,58,237,.12)",
                      borderLeft: isSeen ? "3px solid transparent" : "3px solid var(--a1)",
                    }}
                  >
                    <button type="button" onClick={() => handleNotifClick(n)} style={notifItemStyle}>
                      <div style={notifTitleStyle}>{n.title}</div>
                      {n.body ? <div style={notifBodyStyle}>{n.body}</div> : null}
                      <div style={notifTimeStyle}>{timeAgo(n.createdAt)}</div>
                    </button>
                    <button
                      type="button"
                      aria-label="Delete notification"
                      title="Delete notification"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNotification(n.id);
                      }}
                      style={deleteBtnStyle}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const containerStyle = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const bellBtnStyle = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "6px 8px",
  color: "var(--nav-link-text)",
};

const badgeStyle = {
  position: "absolute",
  top: -2,
  right: -2,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  borderRadius: 999,
  background: "linear-gradient(180deg, #7C3AED, #5b21b6)",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 900,
  boxShadow: "0 4px 12px rgba(124,58,237,.45)",
  pointerEvents: "none",
};

const dropdownStyle = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  width: "min(320px, calc(100vw - 24px))",
  maxHeight: 440,
  background: "var(--bg1)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius2)",
  boxShadow: "var(--shadow)",
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const dropdownHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  flexShrink: 0,
};

const markAllBtnStyle = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--a1)",
  fontSize: 12,
  fontWeight: 600,
  padding: 0,
};

const listStyle = {
  overflowY: "auto",
  flex: 1,
};

const emptyStyle = {
  padding: "32px 16px",
  textAlign: "center",
  color: "var(--muted)",
  fontSize: 13,
};

const notifRowStyle = {
  position: "relative",
  display: "block",
  borderBottom: "1px solid var(--border)",
};

const notifItemStyle = {
  display: "block",
  width: "100%",
  padding: "12px 40px 12px 16px",
  textAlign: "left",
  background: "none",
  border: "none",
  cursor: "pointer",
  transition: "background .15s",
  color: "var(--text)",
};

const notifTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 2,
};

const notifBodyStyle = {
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  lineHeight: 1.4,
};

const notifTimeStyle = {
  fontSize: 11,
  color: "var(--muted2)",
};

const deleteBtnStyle = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,.1)",
  background: "rgba(255,255,255,.06)",
  color: "var(--muted)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  padding: 0,
};
