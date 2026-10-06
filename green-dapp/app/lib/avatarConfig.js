export const AVATAR_BACKGROUND_SLOT = "wallpaper";
export const AVATAR_SHOP_SLOTS = ["wallpaper", "hat", "top", "bottom", "shoes", "accessories"];

export const AVATAR_SLOTS = ["hat", "top", "bottom", "shoes", "accessories", "accessories2"];
export const AVATAR_INVENTORY_SLOTS = [AVATAR_BACKGROUND_SLOT, ...AVATAR_SLOTS];

export const AVATAR_SLOT_LABELS = {
  wallpaper: "Wallpaper",
  hat: "Headwear",
  top: "Top",
  bottom: "Bottom",
  shoes: "Shoes",
  accessories: "Accessory 1",
  accessories2: "Accessory 2",
};

export const AVATAR_SLOT_ICONS = {
  wallpaper: "🖼️",
  hat: "🧢",
  top: "👕",
  bottom: "👖",
  shoes: "👟",
  accessories: "✨",
  accessories2: "💎",
};

export const AVATAR_SLOT_HINTS = {
  wallpaper: "background scenes and avatar backdrops",
  hat: "caps, beanies, head pieces",
  top: "shirts, hoodies, coats",
  bottom: "pants, leggings, shorts",
  shoes: "sneakers, boots, sandals",
  accessories: "arm, neck, face and style items",
  accessories2: "second accessory slot from the same accessory collection",
};

export function createEmptySlotMap() {
  return {
    wallpaper: [],
    hat: [],
    top: [],
    bottom: [],
    shoes: [],
    accessories: [],
    accessories2: [],
  };
}

export function getItemCollectionSlot(slot) {
  if (slot === "accessories2") return "accessories";
  return slot;
}

export function getLayerZIndex(slot) {
  if (slot === "bottom") return 4;
  if (slot === "top") return 7;
  if (slot === "shoes") return 9;
  if (slot === "hat") return 12;
  if (slot === "accessories") return 15;
  if (slot === "accessories2") return 16;
  return 2;
}

export function getSlotAnchor(slot) {
  if (slot === "hat") return { leftPct: 50, topPct: 15 };
  if (slot === "accessories") return { leftPct: 50, topPct: 33 };
  if (slot === "accessories2") return { leftPct: 54, topPct: 35 };
  if (slot === "top") return { leftPct: 50, topPct: 44 };
  if (slot === "bottom") return { leftPct: 50, topPct: 71 };
  if (slot === "shoes") return { leftPct: 50, topPct: 95 };
  return { leftPct: 50, topPct: 50 };
}

export function getSlotScale(slot, item = null) {
  if (item && Number.isFinite(Number(item.scale))) return Number(item.scale);
  if (slot === "hat") return 0.28;
  if (slot === "top") return 0.32;
  if (slot === "bottom") return 0.22;
  if (slot === "shoes") return 0.28;
  if (slot === "accessories") return 0.26;
  if (slot === "accessories2") return 0.24;
  return 1;
}

export function getSlotScaleX(slot, item = null) {
  const baseScale = getSlotScale(slot, item);
  if (item && Number.isFinite(Number(item.scaleX))) return Number(item.scaleX);
  return baseScale;
}

export function getSlotScaleY(slot, item = null) {
  const baseScale = getSlotScale(slot, item);
  if (item && Number.isFinite(Number(item.scaleY))) return Number(item.scaleY);
  return baseScale;
}

export function isItemCompatibleWithCharacter(_item, _character) {
  return true;
}
