import items from "../../public/items/items.json";

export const COSMETIC_TOKEN_ID_OFFSET = 1000;

export function getCosmeticTokenIdByIndex(index) {
  return COSMETIC_TOKEN_ID_OFFSET + index + 1;
}

export function getCosmeticMetadataUri(itemId) {
  return `greencommute://cosmetics/${itemId}`;
}

function deriveRarity(item) {
  if (item.tags?.includes("reward") || item.tags?.includes("legendary")) return "legendary";
  if (item.price >= 24) return "epic";
  if (item.price >= 18) return "rare";
  if (item.price >= 14) return "uncommon";
  return "common";
}

function deriveTheme(item) {
  const tags = item.tags || [];

  if (item.slot === "wallpaper") return "scene";
  if (tags.includes("reward")) return "reward";
  if (tags.includes("eco")) return "eco";
  if (tags.includes("street")) return "street";
  if (tags.includes("cute") || tags.includes("playful")) return "cute";
  if (tags.includes("winter")) return "winter";
  if (tags.includes("formal")) return "formal";
  if (tags.includes("sport")) return "sport";
  if (tags.includes("graphic")) return "graphic";
  if (tags.includes("jewelry")) return "jewelry";
  if (tags.includes("casual")) return "casual";
  return "everyday";
}

export const cosmeticTokenCatalog = items.map((item) => ({
  tokenId: item.tokenId,
  itemId: item.id,
  name: item.name,
  slot: item.slot,
  price: item.price,
  image: item.image,
  tags: item.tags || [],
  rarity: deriveRarity(item),
  theme: deriveTheme(item),
  metadataUri: getCosmeticMetadataUri(item.id),
}));

export const cosmeticTokenMap = Object.fromEntries(
  cosmeticTokenCatalog.map((entry) => [entry.itemId, entry])
);

export function getCosmeticToken(itemId) {
  return cosmeticTokenMap[itemId] || null;
}
