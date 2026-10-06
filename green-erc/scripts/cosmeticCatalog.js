const fs = require("fs");
const path = require("path");

const ITEMS_PATH = path.resolve(__dirname, "../../green-dapp/public/items/items.json");
const TOKEN_ID_OFFSET = 1000;

function loadItems() {
  return JSON.parse(fs.readFileSync(ITEMS_PATH, "utf8"));
}

function getTokenIdForIndex(index) {
  return TOKEN_ID_OFFSET + index + 1;
}

function getMetadataUri(item) {
  return `greencommute://cosmetics/${item.id}`;
}

function buildCosmeticCatalog() {
  return loadItems().map((item) => ({
    tokenId: item.tokenId,
    itemId: item.id,
    name: item.name,
    slot: item.slot,
    price: item.price,
    image: item.image,
    metadataUri: getMetadataUri(item),
  }));
}

module.exports = {
  ITEMS_PATH,
  TOKEN_ID_OFFSET,
  buildCosmeticCatalog,
  getMetadataUri,
  getTokenIdForIndex,
  loadItems,
};
