const API =
  typeof window !== "undefined"
    ? "/api-proxy"
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:4100";

export { API };

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    cache: "no-store",
    ...options,
  });
  const text = await res.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`API did not return JSON (${res.status}) on ${path}: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.details
      ? `${json.error || "Request failed"} | ${typeof json.details === "string" ? json.details : JSON.stringify(json.details)}`
      : (json?.error || `Request failed (${res.status})`);
    throw new Error(msg);
  }

  return json;
}

export async function apiGet(path) {
  return apiRequest(path);
}

export async function apiPost(path, body) {
  return apiRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export async function apiDelete(path, body) {
  return apiRequest(path, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function fmt(n, digits = 2) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function shortAddr(a) {
  if (!a) return "";
  const s = String(a);
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

export function communityName(displayName, walletAddress) {
  const cleanName = typeof displayName === "string" ? displayName.trim() : "";
  if (cleanName) return cleanName;

  const wallet = String(walletAddress || "").trim();
  if (!wallet) return "Green Commuter";

  const suffix = wallet.slice(-4).toLowerCase() || "user";
  return `Green Commuter ${suffix}`;
}

export function formatLastActive(presence) {
  if (!presence?.lastActiveAt) return "No recent activity";
  if (presence?.isOnline) return "Online now";
  const diffMs = Date.now() - new Date(presence.lastActiveAt).getTime();
  const diffMin = Math.max(1, Math.round(diffMs / 60000));
  if (diffMin < 60) return `Active ${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Active ${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Active ${diffDay}d ago`;
}

export function getItemRarity(item) {
  const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [];
  if (tags.includes("legendary") || tags.includes("reward")) return "Legendary";
  const price = Number(item?.price || 0);
  if (price >= 24) return "Epic";
  if (price >= 18) return "Rare";
  if (price >= 14) return "Uncommon";
  return "Common";
}

export function getItemTheme(item) {
  const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).toLowerCase()) : [];
  if (tags.some((tag) => ["street", "cargo", "skate", "chain", "skull", "flame"].includes(tag))) return "Street";
  if (tags.some((tag) => ["cute", "bunny", "bow", "playful", "graphic"].includes(tag))) return "Cute";
  if (tags.some((tag) => ["winter", "scarf", "coat", "beanie"].includes(tag))) return "Winter";
  if (tags.some((tag) => ["background", "nature", "park", "eco"].includes(tag))) return "Eco";
  if (tags.some((tag) => ["formal", "office", "clean", "classic"].includes(tag))) return "Classic";
  return "Daily";
}
