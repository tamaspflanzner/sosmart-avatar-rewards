const KEY_PREFIX = "green_balance_v1:";

function keyFor(address) {
  return `${KEY_PREFIX}${(address || "guest").toLowerCase()}`;
}

export function loadSpent(address) {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(keyFor(address));
  const n = Number(raw || "0");
  return Number.isFinite(n) ? n : 0;
}

export function addSpent(address, amount) {
  if (typeof window === "undefined") return;
  const cur = loadSpent(address);
  const next = cur + Number(amount || 0);
  localStorage.setItem(keyFor(address), String(next));
}

export function resetSpent(address) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyFor(address));
}
