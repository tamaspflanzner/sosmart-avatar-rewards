const KEY_PREFIX = "green_inventory_v1:";

function keyFor(address) {
  return `${KEY_PREFIX}${(address || "guest").toLowerCase()}`;
}

export function loadInventory(address) {
  if (typeof window === "undefined") return { owned: [], equipped: { character: "girl" } };
  const raw = localStorage.getItem(keyFor(address));
  if (!raw) return { owned: [], equipped: { character: "girl" } };
  try {
    const parsed = JSON.parse(raw);
    return {
  owned: Array.isArray(parsed.owned) ? parsed.owned : [],
  equipped: typeof parsed.equipped === "object" && parsed.equipped ? parsed.equipped : { character: "girl" },
  offsets: typeof parsed.offsets === "object" && parsed.offsets ? parsed.offsets : {},
};
  } catch {
    return { owned: [], equipped: { character: "girl" }, offsets: {} };
  }
}

export function saveInventory(address, inv) {
  if (typeof window === "undefined") return;
  localStorage.setItem(keyFor(address), JSON.stringify(inv));
}

export function isOwned(inv, itemId) {
  return inv.owned.includes(itemId);
}

export function addOwned(inv, itemId) {
  if (!inv.owned.includes(itemId)) inv.owned.push(itemId);
  return inv;
}

export function equipItem(inv, slot, itemId) {
  inv.equipped = inv.equipped || {};
  inv.equipped[slot] = itemId;
  return inv;
}

export function setCharacter(inv, character) {
  inv.equipped = inv.equipped || {};
  inv.equipped.character = character; // "girl" | "boy"
  return inv;
}
