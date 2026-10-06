"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { injected, useAccount, useConnect, useDisconnect } from "wagmi";
import { useWallet } from "../../lib/useWallet";
import { API } from "../lib/api";
import NotificationBell from "./NotificationBell";

const THEMES = [
  { id: "dark", label: "Dark", emoji: "🌙" },
  { id: "light", label: "Light", emoji: "☀️" },
  { id: "ocean", label: "Ocean", emoji: "🌊" },
  { id: "pink", label: "Pink", emoji: "🌸" },
];

function HamburgerIcon({ open }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      {open ? (
        <>
          <line x1="4" y1="4" x2="18" y2="18" />
          <line x1="18" y1="4" x2="4" y2="18" />
        </>
      ) : (
        <>
          <line x1="3" y1="6" x2="19" y2="6" />
          <line x1="3" y1="11" x2="19" y2="11" />
          <line x1="3" y1="16" x2="19" y2="16" />
        </>
      )}
    </svg>
  );
}

export default function Nav() {
  const { isConnected: wagmiConnected } = useAccount();
  const { connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    aaEnabled,
    address,
    isConnected,
    isEmbedded,
    embeddedEmail,
    openEmbeddedAuthModal,
    logoutEmbedded,
  } = useWallet();
  const [theme, setTheme] = useState("dark");
  const [chatUnread, setChatUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let timer;
    try {
      const saved = localStorage.getItem("green_theme");
      if (saved && THEMES.some((t) => t.id === saved)) {
        timer = window.setTimeout(() => setTheme(saved), 0);
      }
    } catch {}
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadUnread() {
      if (!isConnected || !address) {
        setChatUnread(0);
        return;
      }
      try {
        const [inboxRes, socialRes] = await Promise.all([
          fetch(`${API}/api/users/${address}/direct-inbox`, { cache: "no-store" }),
          fetch(`${API}/api/users/${address}/social`, { cache: "no-store" }),
        ]);
        const inboxJson = await inboxRes.json().catch(() => null);
        const socialJson = await socialRes.json().catch(() => null);
        if (cancelled) return;
        const groupUnread = Array.isArray(socialJson?.groups)
          ? socialJson.groups.reduce((sum, group) => sum + Number(group?.unreadCount || 0), 0)
          : 0;
        setChatUnread(Number(inboxJson?.totalUnreadCount || 0) + groupUnread);
      } catch {
        if (!cancelled) setChatUnread(0);
      }
    }

    loadUnread();
    const timer = window.setInterval(loadUnread, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isConnected, address]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleOutside(event) {
      if (!navRef.current) return;
      if (!navRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [menuOpen]);

  const connected = isConnected;
  const dotClass = connected ? "dot on" : "dot off";
  const dotTitle = connected ? "wallet connected" : "not connected";

  const displayLabel = embeddedEmail
    ? embeddedEmail.length > 18
      ? `${embeddedEmail.slice(0, 16)}...`
      : embeddedEmail
    : address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Connected";

  function onThemeChange(nextTheme) {
    setTheme(nextTheme);
    try {
      localStorage.setItem("green_theme", nextTheme);
    } catch {}
  }

  function cycleTheme() {
    const idx = THEMES.findIndex((t) => t.id === theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    onThemeChange(next.id);
  }

  async function handleConnect() {
    if (aaEnabled) {
      openEmbeddedAuthModal();
      return;
    }

    try {
      await connectAsync({ connector: injected() });
    } catch {}
  }

  async function handleDisconnect() {
    if (isEmbedded) {
      await logoutEmbedded();
      return;
    }
    if (wagmiConnected) disconnect();
  }

  const currentTheme = THEMES.find((t) => t.id === theme) || THEMES[0];
  const connectButton = !mounted ? (
    <button className="nav-connect-btn" type="button" suppressHydrationWarning>
      Connect
    </button>
  ) : connected ? (
    <button
      className="nav-connect-btn nav-connect-btn--connected"
      type="button"
      title="Disconnect"
      onClick={handleDisconnect}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{displayLabel}</span>
      <span className="nav-connect-close" style={{ flexShrink: 0 }}>×</span>
    </button>
  ) : (
    <button
      className="nav-connect-btn"
      type="button"
      onClick={handleConnect}
    >
      Connect
    </button>
  );

  return (
    <nav className="nav" ref={navRef}>
      <div className="nav-left">
        <div className="brand">Green Commute</div>
        <div className={dotClass} title={dotTitle} suppressHydrationWarning />
      </div>

      <div className="nav-mobile-actions">
        <div className="nav-mobile-only">
          <NotificationBell />
        </div>
        <div className="nav-mobile-only">
          {connectButton}
        </div>
      </div>

      <button
        className="nav-hamburger"
        type="button"
        aria-label="Open navigation"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <HamburgerIcon open={menuOpen} />
      </button>

      <div className={`nav-links${menuOpen ? " open" : ""}`}>
        <Link href="/" className="nav-link" onClick={() => setMenuOpen(false)}>Dashboard</Link>
        <Link href="/analytics" className="nav-link" onClick={() => setMenuOpen(false)}>Analytics</Link>
        <Link href="/community" className="nav-link" onClick={() => setMenuOpen(false)}>Community</Link>
        <Link href="/shop" className="nav-link" onClick={() => setMenuOpen(false)}>Shop</Link>
        <Link href="/chat" className="nav-link" style={{ position: "relative" }} onClick={() => setMenuOpen(false)}>
          Chat
          {chatUnread > 0 ? <span style={chatBadge}>{chatUnread > 99 ? "99+" : chatUnread}</span> : null}
        </Link>
        <Link href="/profile" className="nav-link" onClick={() => setMenuOpen(false)}>Profile</Link>
        <Link href="/avatar" className="nav-link" onClick={() => setMenuOpen(false)}>Avatar</Link>

        <div className="nav-desktop-only">
          {connectButton}
        </div>

        <div className="nav-desktop-only">
          <NotificationBell />
        </div>

        <button className="theme-cycle-btn" onClick={cycleTheme} type="button" title="Switch theme">
          <span className="theme-emoji">{currentTheme.emoji}</span>
          <span className="theme-text">{currentTheme.label}</span>
        </button>
      </div>
    </nav>
  );
}

const chatBadge = {
  position: "absolute",
  top: -8,
  right: -10,
  minWidth: 22,
  height: 22,
  padding: "0 6px",
  borderRadius: 999,
  background: "linear-gradient(180deg, rgba(34,211,238,.95), rgba(16,185,129,.92))",
  color: "#04121b",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 900,
  boxShadow: "0 8px 20px rgba(34,211,238,.28)",
};
