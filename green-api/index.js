const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { z } = require("zod");
const { ethers } = require("ethers");
const fs = require("fs");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 4100);

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "green-api",
    time: new Date().toISOString(),
  });
});

// ----------------------------------------------------
// CONFIG / CONSTANTS
// ----------------------------------------------------
const FACTORS = {
  baseline_car: 171,
  bus: 104,
  rail: 41,
  monorail: 41,
  park_ride: 120,
};

const REWARD_RULES = {
  tokenSymbol: "GCT",
  basePerKm: 1.0,
  multipliers: {
    bus: 1.0,
    rail: 1.2,
    monorail: 1.2,
    "park&ride": 0.8,
  },
  maxTokensPerEvent: 30,
};

const CLAIM_RESERVED_STATUSES = ["submitted", "confirmed"];
const GCT_DECIMALS = 18;
const GCT_EIP712_DOMAIN_NAME = "GreenCommuteToken";
const GCT_EIP712_DOMAIN_VERSION = "1";
const GROUP_CROWN_TARGET_KM = 2000;
const GROUP_CHALLENGE_MIN_KM = 25;
const GROUP_CHALLENGE_SCORE_FACTOR = 0.35;
const GROUP_CHALLENGE_SCORE_CAP = 250;
const GROUP_CROWN_REWARD_CODE = "global_crown_2000km";
const COSMETIC_TOKEN_ID_OFFSET = 1000;

const GCT_CONFIG = {
  contractAddress: String(process.env.GCT_CONTRACT_ADDRESS || "").trim().toLowerCase(),
  chainId: Number(process.env.GCT_CHAIN_ID || 31337),
  rpcUrl: String(process.env.GCT_RPC_URL || "http://127.0.0.1:8545").trim(),
  oraclePrivateKey: String(process.env.GCT_ORACLE_PRIVATE_KEY || "").trim(),
  claimExpirySeconds: Math.max(60, Number(process.env.GCT_CLAIM_EXPIRY_SECONDS || 3600)),
  burnAddress: String(process.env.GCT_BURN_ADDRESS || "0x000000000000000000000000000000000000dEaD")
    .trim()
    .toLowerCase(),
};

const COSMETICS_CONFIG = {
  contractAddress: String(process.env.COSMETICS_CONTRACT_ADDRESS || "").trim().toLowerCase(),
  chainId: Number(process.env.COSMETICS_CHAIN_ID || GCT_CONFIG.chainId || 31337),
  baseUri: String(process.env.COSMETICS_BASE_URI || "greencommute://cosmetics/{id}").trim(),
  adminPrivateKey: String(
    process.env.COSMETICS_ADMIN_PRIVATE_KEY || process.env.GCT_ORACLE_PRIVATE_KEY || ""
  ).trim(),
};

const GCT_EIP712_TYPES = {
  Claim: [
    { name: "user", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

const gctInterface = new ethers.Interface([
  "event RewardClaimed(address indexed user, uint256 amount, uint256 nonce)",
]);
const gctReadInterface = new ethers.Interface([
  "function balanceOf(address account) view returns (uint256)",
]);
const gctErc20Interface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const gctWriteInterface = new ethers.Interface([
  "function claimReward(address user, uint256 amount, uint256 nonce, uint256 expiry, bytes signature)",
]);
const cosmeticsReadInterface = new ethers.Interface([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
]);
const cosmeticsWriteInterface = new ethers.Interface([
  "function mintTo(address to, uint256 tokenId, uint256 amount, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
  "function burn(address account, uint256 id, uint256 value)",
]);
const cosmeticsEventInterface = new ethers.Interface([
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
]);

const dummyState = {
  running: false,
  minMs: 5000,
  maxMs: 20000,
  timer: null,
  sent: 0,
};

const dummyWallets = [
  "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
  "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
  "0xcd3B766CCDd6AE721141F452C550Ca635964ce71",
  "0xC927aad930e2fc68c2765c7a5FBD99b03121c6FB",
  "0xE1887301cE15fEFb9F2Fd10a4628F52cB500AD5c",
];

const dummyTripTypes = ["bus", "rail", "monorail", "park&ride"];

// ----------------------------------------------------
// HELPERS
// ----------------------------------------------------
function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function nowIso() {
  return new Date().toISOString();
}

function pickRows(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.rows)) return result.rows;
  return [];
}

async function q(sql, params = []) {
  const result = await db.query(sql, params);
  return pickRows(result);
}

function normalizeWalletAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTripTypeToDb(tripType) {
  return tripType;
}

function normalizeTripTypeFromDb(tripType) {
  return tripType;
}

function eventId() {
  return "evt_" + Math.random().toString(16).slice(2);
}

function safeJsonParse(txt, fallback = null) {
  try {
    if (txt == null) return fallback;
    return typeof txt === "string" ? JSON.parse(txt) : txt;
  } catch {
    return fallback;
  }
}

function co2SavedKgForEvent(e) {
  if (typeof e.distanceKm !== "number") return 0;

  const car = FACTORS.baseline_car;
  const mode =
    e.tripType === "bus"
      ? FACTORS.bus
      : e.tripType === "rail"
      ? FACTORS.rail
      : e.tripType === "monorail"
      ? FACTORS.monorail
      : FACTORS.park_ride;

  const diff_g_per_km = Math.max(0, car - mode);
  const saved_g = e.distanceKm * diff_g_per_km;
  return saved_g / 1000.0;
}

function rewardTokensForEvent(e) {
  if (typeof e.distanceKm !== "number") return 0;
  const m = REWARD_RULES.multipliers[e.tripType] ?? 1.0;
  const raw = e.distanceKm * REWARD_RULES.basePerKm * m;
  return Math.min(REWARD_RULES.maxTokensPerEvent, raw);
}

function mapDbEventRowToApi(row) {
  return {
    id: row.event_id || `db_${row.id}`,
    walletAddress: row.wallet_address,
    tripType: normalizeTripTypeFromDb(row.trip_type),
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    routeId: row.route_id,
    stopId: row.stop_id,
    source: row.source,
    ts: row.event_ts_ms == null ? null : Number(row.event_ts_ms),
    eventTime: row.event_time instanceof Date ? row.event_time.toISOString() : row.event_time,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function getGctProvider() {
  return new ethers.JsonRpcProvider(GCT_CONFIG.rpcUrl, GCT_CONFIG.chainId);
}

let gctRpcHealthCache = {
  checkedAt: 0,
  reachable: null,
};

let cosmeticsAdminQueue = Promise.resolve();

async function isGctRpcReachable() {
  const now = Date.now();
  if (now - gctRpcHealthCache.checkedAt < 3000 && gctRpcHealthCache.reachable != null) {
    return gctRpcHealthCache.reachable;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const res = await fetch(GCT_CONFIG.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: controller.signal,
    });

    const reachable = res.ok;
    gctRpcHealthCache = {
      checkedAt: now,
      reachable,
    };
    return reachable;
  } catch {
    gctRpcHealthCache = {
      checkedAt: now,
      reachable: false,
    };
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function getOracleWallet() {
  if (!GCT_CONFIG.oraclePrivateKey) {
    throw new Error("Missing GCT_ORACLE_PRIVATE_KEY");
  }
  return new ethers.Wallet(GCT_CONFIG.oraclePrivateKey, getGctProvider());
}

function hasCosmeticsContractConfigured() {
  return ethers.isAddress(COSMETICS_CONFIG.contractAddress);
}

function getCosmeticsProvider() {
  return new ethers.JsonRpcProvider(GCT_CONFIG.rpcUrl, COSMETICS_CONFIG.chainId);
}

function getCosmeticsAdminWallet() {
  if (!COSMETICS_CONFIG.adminPrivateKey) {
    throw new Error("Missing COSMETICS_ADMIN_PRIVATE_KEY or fallback GCT_ORACLE_PRIVATE_KEY");
  }
  return new ethers.Wallet(COSMETICS_CONFIG.adminPrivateKey, getCosmeticsProvider());
}

function getCosmeticsOperatorAddress() {
  if (!hasCosmeticsContractConfigured() || !COSMETICS_CONFIG.adminPrivateKey) return null;
  try {
    return getCosmeticsAdminWallet().address.toLowerCase();
  } catch {
    return null;
  }
}

async function withCosmeticsAdminLock(task) {
  const run = cosmeticsAdminQueue.then(() => task());
  cosmeticsAdminQueue = run.catch(() => null);
  return run;
}

async function sendCosmeticsAdminTransaction(data, nonce = null) {
  return withCosmeticsAdminLock(async () => {
    const wallet = getCosmeticsAdminWallet();
    const tx = await wallet.sendTransaction({
      to: COSMETICS_CONFIG.contractAddress,
      data,
      ...(nonce == null ? {} : { nonce }),
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Cosmetics admin transaction failed");
    }
    return { tx, receipt, walletAddress: wallet.address.toLowerCase() };
  });
}

function getGctDomain() {
  if (!ethers.isAddress(GCT_CONFIG.contractAddress)) {
    throw new Error("Invalid GCT_CONTRACT_ADDRESS");
  }

  return {
    name: GCT_EIP712_DOMAIN_NAME,
    version: GCT_EIP712_DOMAIN_VERSION,
    chainId: GCT_CONFIG.chainId,
    verifyingContract: GCT_CONFIG.contractAddress,
  };
}

function tokensToWei(amountTokens) {
  const amount = Number(amountTokens);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid token amount");
  }
  return ethers.parseUnits(amount.toFixed(6), GCT_DECIMALS);
}

function isValidTxHash(txHash) {
  return typeof txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(txHash.trim());
}

function statsWalletFilterFromReq(req) {
  const raw = req?.query?.wallet;
  if (!raw) return null;
  const normalized = normalizeWalletAddress(raw);
  if (!normalized || normalized.length < 6) return null;
  return normalized;
}

async function getOnChainBalanceWei(walletAddress) {
  if (!ethers.isAddress(walletAddress)) {
    throw new Error("Invalid wallet address for on-chain balance");
  }
  if (!ethers.isAddress(GCT_CONFIG.contractAddress)) {
    return { wei: 0n, status: "no_contract_configured" };
  }
  if (!(await isGctRpcReachable())) {
    console.warn("[GCT] RPC is unreachable, returning zero on-chain balance:", GCT_CONFIG.rpcUrl);
    return { wei: 0n, status: "rpc_unreachable" };
  }

  const provider = getGctProvider();
  const contractCode = await provider.getCode(GCT_CONFIG.contractAddress);
  if (!contractCode || contractCode === "0x") {
    console.warn(
      "[GCT] No contract code found at configured address, returning zero on-chain balance:",
      GCT_CONFIG.contractAddress
    );
    return { wei: 0n, status: "contract_not_deployed" };
  }

  const data = gctReadInterface.encodeFunctionData("balanceOf", [walletAddress]);
  try {
    const result = await provider.call({
      to: GCT_CONFIG.contractAddress,
      data,
    });
    if (!result || result === "0x") {
      console.warn(
        "[GCT] balanceOf returned empty data, returning zero on-chain balance:",
        GCT_CONFIG.contractAddress
      );
      return { wei: 0n, status: "empty_response" };
    }
    const [balanceWei] = gctReadInterface.decodeFunctionResult("balanceOf", result);
    return { wei: balanceWei, status: "ok" };
  } catch (error) {
    if (error?.code === "BAD_DATA" || error?.code === "CALL_EXCEPTION") {
      console.warn(
        "[GCT] Failed to read on-chain balance, returning zero on-chain balance:",
        error?.message || error
      );
      return { wei: 0n, status: "call_failed" };
    }
    throw error;
  }
}

function getAvatarItemById(itemId) {
  const items = loadAvatarItemManifest();
  return items.find((item) => String(item?.id || "") === String(itemId || "")) || null;
}

function getCosmeticTokenId(itemId) {
  const items = loadAvatarItemManifest();
  const item = items.find((i) => String(i?.id || "") === String(itemId || ""));
  if (!item) return null;
  return Number.isFinite(item.tokenId) ? item.tokenId : null;
}

function isTokenizedAvatarItem(itemId) {
  return Number.isFinite(getCosmeticTokenId(itemId));
}

function getCosmeticMetadataUri(itemId) {
  return `greencommute://cosmetics/${itemId}`;
}

async function getOnChainCosmeticBalance(walletAddress, itemId) {
  if (!hasCosmeticsContractConfigured()) return 0n;
  if (!ethers.isAddress(walletAddress)) return 0n;
  const tokenId = getCosmeticTokenId(itemId);
  if (!Number.isFinite(tokenId) || tokenId <= 0) return 0n;
  if (!(await isGctRpcReachable())) return 0n;

  const provider = getCosmeticsProvider();
  const code = await provider.getCode(COSMETICS_CONFIG.contractAddress);
  if (!code || code === "0x") return 0n;

  try {
    const data = cosmeticsReadInterface.encodeFunctionData("balanceOf", [walletAddress, tokenId]);
    const result = await provider.call({
      to: COSMETICS_CONFIG.contractAddress,
      data,
    });
    if (!result || result === "0x") return 0n;
    const [balance] = cosmeticsReadInterface.decodeFunctionResult("balanceOf", result);
    return balance;
  } catch {
    return 0n;
  }
}

async function getOnChainOwnedCosmeticItemIds(walletAddress) {
  if (!hasCosmeticsContractConfigured()) return [];
  if (!ethers.isAddress(walletAddress)) return [];
  if (!(await isGctRpcReachable())) return [];

  const items = loadAvatarItemManifest();
  if (!items.length) return [];

  const provider = getCosmeticsProvider();
  const code = await provider.getCode(COSMETICS_CONFIG.contractAddress);
  if (!code || code === "0x") return [];

  try {
    const tokenIds = items.map((item) => BigInt(item.tokenId));
    const accounts = tokenIds.map(() => walletAddress);
    const data = cosmeticsReadInterface.encodeFunctionData("balanceOfBatch", [accounts, tokenIds]);
    const result = await provider.call({
      to: COSMETICS_CONFIG.contractAddress,
      data,
    });
    if (!result || result === "0x") return [];
    const [balances] = cosmeticsReadInterface.decodeFunctionResult("balanceOfBatch", result);
    return items
      .filter((_, index) => BigInt(balances[index] || 0) > 0n)
      .map((item) => item.id);
  } catch (error) {
    console.warn("[COSMETICS] Failed to read on-chain owned items:", error?.message || error);
    return [];
  }
}

async function isCosmeticsOperatorApproved(walletAddress, operatorAddress = getCosmeticsOperatorAddress()) {
  if (!hasCosmeticsContractConfigured()) return false;
  if (!ethers.isAddress(walletAddress) || !ethers.isAddress(operatorAddress || "")) return false;
  if (!(await isGctRpcReachable())) return false;

  const provider = getCosmeticsProvider();
  const code = await provider.getCode(COSMETICS_CONFIG.contractAddress);
  if (!code || code === "0x") return false;

  try {
    const data = cosmeticsReadInterface.encodeFunctionData("isApprovedForAll", [walletAddress, operatorAddress]);
    const result = await provider.call({
      to: COSMETICS_CONFIG.contractAddress,
      data,
    });
    if (!result || result === "0x") return false;
    const [approved] = cosmeticsReadInterface.decodeFunctionResult("isApprovedForAll", result);
    return Boolean(approved);
  } catch {
    return false;
  }
}

async function ensureWalletOwnsCosmeticItemOnChain(walletAddress, itemId) {
  if (!hasCosmeticsContractConfigured()) {
    return {
      configured: false,
      minted: false,
      tokenId: getCosmeticTokenId(itemId),
      txHash: null,
      metadataUri: getCosmeticMetadataUri(itemId),
    };
  }
  if (!(await isGctRpcReachable())) {
    throw new Error("RPC is unreachable for cosmetics mint");
  }
  if (!ethers.isAddress(walletAddress)) {
    throw new Error("Invalid wallet for cosmetics mint");
  }

  const tokenId = getCosmeticTokenId(itemId);
  if (!Number.isFinite(tokenId) || tokenId <= 0) {
    throw new Error(`Unknown cosmetic itemId: ${itemId}`);
  }

  const currentBalance = await getOnChainCosmeticBalance(walletAddress, itemId);
  if (currentBalance > 0n) {
    return {
      configured: true,
      minted: false,
      tokenId,
      txHash: null,
      metadataUri: getCosmeticMetadataUri(itemId),
    };
  }

  const { tx } = await sendCosmeticsAdminTransaction(
    cosmeticsWriteInterface.encodeFunctionData("mintTo", [walletAddress, BigInt(tokenId), 1n, "0x"])
  );

  return {
    configured: true,
    minted: true,
    tokenId,
    txHash: tx.hash,
    metadataUri: getCosmeticMetadataUri(itemId),
  };
}

async function reconcileWalletCosmeticItemOnChain(walletAddress, itemId, desiredCount = 0) {
  const wallet = normalizeWalletAddress(walletAddress);
  const tokenId = getCosmeticTokenId(itemId);
  if (!hasCosmeticsContractConfigured() || !ethers.isAddress(wallet) || !Number.isFinite(tokenId)) {
    return {
      itemId,
      tokenId,
      desiredCount: Math.max(0, Number(desiredCount || 0)),
      currentCount: 0,
      minted: 0,
      burned: 0,
      skippedBurn: false,
      txHashes: [],
    };
  }

  const desired = Math.max(0, Number(desiredCount || 0));
  const current = Number(await getOnChainCosmeticBalance(wallet, itemId));
  const txHashes = [];
  let minted = 0;
  let burned = 0;
  let skippedBurn = false;

  if (current < desired) {
    const mintAmount = desired - current;
    const { tx } = await sendCosmeticsAdminTransaction(
      cosmeticsWriteInterface.encodeFunctionData("mintTo", [wallet, BigInt(tokenId), BigInt(mintAmount), "0x"])
    );
    txHashes.push(tx.hash);
    minted = mintAmount;
  } else if (current > desired) {
    const burnAmount = current - desired;
    const operatorWallet = getCosmeticsOperatorAddress();
    const approved = await isCosmeticsOperatorApproved(wallet, operatorWallet);
    if (approved) {
      const { tx } = await sendCosmeticsAdminTransaction(
        cosmeticsWriteInterface.encodeFunctionData("burn", [wallet, BigInt(tokenId), BigInt(burnAmount)])
      );
      txHashes.push(tx.hash);
      burned = burnAmount;
    } else {
      skippedBurn = true;
    }
  }

  return {
    itemId,
    tokenId,
    desiredCount: desired,
    currentCount: current,
    minted,
    burned,
    skippedBurn,
    txHashes,
  };
}

async function syncOwnedCosmeticsToChain(walletAddress) {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!hasCosmeticsContractConfigured()) {
    return {
      configured: false,
      syncedItemIds: [],
      mintedCount: 0,
    };
  }

  const purchaseRows = await q(
    `
    SELECT item_id, COUNT(*) AS cnt
    FROM shop_purchases
    WHERE wallet_address = ?
      AND item_id IS NOT NULL
    GROUP BY item_id
    ORDER BY item_id ASC
    `,
    [wallet]
  );
  const outgoingRows = await q(
    `
    SELECT item_id, COUNT(*) AS cnt
    FROM cosmetic_transfers
    WHERE from_wallet = ?
      AND item_id IS NOT NULL
    GROUP BY item_id
    `,
    [wallet]
  );
  const incomingRows = await q(
    `
    SELECT item_id, COUNT(*) AS cnt
    FROM cosmetic_transfers
    WHERE to_wallet = ?
      AND item_id IS NOT NULL
    GROUP BY item_id
    `,
    [wallet]
  );

  const desiredCounts = new Map();
  for (const row of purchaseRows) {
    const itemId = String(row.item_id || "").trim();
    if (!isTokenizedAvatarItem(itemId)) continue;
    desiredCounts.set(itemId, (desiredCounts.get(itemId) || 0) + Number(row.cnt || 0));
  }
  for (const row of incomingRows) {
    const itemId = String(row.item_id || "").trim();
    if (!isTokenizedAvatarItem(itemId)) continue;
    desiredCounts.set(itemId, (desiredCounts.get(itemId) || 0) + Number(row.cnt || 0));
  }
  for (const row of outgoingRows) {
    const itemId = String(row.item_id || "").trim();
    if (!isTokenizedAvatarItem(itemId)) continue;
    desiredCounts.set(itemId, (desiredCounts.get(itemId) || 0) - Number(row.cnt || 0));
  }

  const tokenizedItemIds = [...desiredCounts.keys()].filter((itemId) => isTokenizedAvatarItem(itemId));

  const results = [];
  for (const itemId of tokenizedItemIds) {
    const desired = Math.max(0, desiredCounts.get(itemId) || 0);
    const result = await reconcileWalletCosmeticItemOnChain(wallet, itemId, desired);
    results.push(result);
  }

  return {
    configured: true,
    syncedItemIds: tokenizedItemIds,
    mintedCount: results.reduce((sum, entry) => sum + Number(entry.minted || 0), 0),
    burnedCount: results.reduce((sum, entry) => sum + Number(entry.burned || 0), 0),
    results,
  };
}

async function confirmCosmeticTransferOnChain({
  txHash,
  chainId,
  fromWallet,
  toWallet,
  itemId,
}) {
  if (!hasCosmeticsContractConfigured()) {
    throw new Error("Cosmetics contract is not configured");
  }
  if (chainId !== COSMETICS_CONFIG.chainId) {
    throw new Error(`Invalid cosmetics chainId, expected ${COSMETICS_CONFIG.chainId}`);
  }
  if (!isValidTxHash(txHash)) {
    throw new Error("txHash is required and must be a valid 0x hash");
  }
  if (!(await isGctRpcReachable())) {
    throw new Error("RPC is unreachable for cosmetics transfer validation");
  }

  const tokenId = getCosmeticTokenId(itemId);
  if (!Number.isFinite(tokenId) || tokenId <= 0) {
    throw new Error("Unknown cosmetic item");
  }

  const provider = getCosmeticsProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("Transfer transaction is not mined yet");
  if (receipt.status !== 1) throw new Error("Transfer transaction reverted");

  const expectedFrom = normalizeWalletAddress(fromWallet);
  const expectedTo = normalizeWalletAddress(toWallet);
  let matchedLog = null;

  for (const log of receipt.logs || []) {
    if (normalizeWalletAddress(log.address) !== COSMETICS_CONFIG.contractAddress) continue;
    try {
      const parsed = cosmeticsEventInterface.parseLog(log);
      if (!parsed || parsed.name !== "TransferSingle") continue;

      const eventFrom = normalizeWalletAddress(parsed.args.from);
      const eventTo = normalizeWalletAddress(parsed.args.to);
      const eventTokenId = Number(parsed.args.id);
      const eventAmount = Number(parsed.args.value);

      if (
        eventFrom === expectedFrom &&
        eventTo === expectedTo &&
        eventTokenId === tokenId &&
        eventAmount === 1
      ) {
        matchedLog = {
          operatorWallet: normalizeWalletAddress(parsed.args.operator),
          tokenId: eventTokenId,
          amount: eventAmount,
        };
        break;
      }
    } catch {
      // ignore unrelated logs
    }
  }

  if (!matchedLog) {
    throw new Error("Cosmetic transfer event validation failed");
  }

  return {
    txHash,
    chainId,
    tokenId,
    amount: matchedLog.amount,
    operatorWallet: matchedLog.operatorWallet,
  };
}

async function executeCosmeticTradeSwap({
  listingOwnerWallet,
  listingItemId,
  offererWallet,
  offeredItemId,
}) {
  if (!hasCosmeticsContractConfigured()) {
    throw new Error("Cosmetics contract is not configured");
  }
  if (!(await isGctRpcReachable())) {
    throw new Error("RPC is unreachable for cosmetics trade swap");
  }

  const ownerWallet = normalizeWalletAddress(listingOwnerWallet);
  const otherWallet = normalizeWalletAddress(offererWallet);
  const listingTokenId = getCosmeticTokenId(listingItemId);
  const offeredTokenId = getCosmeticTokenId(offeredItemId);
  if (!Number.isFinite(listingTokenId) || !Number.isFinite(offeredTokenId)) {
    throw new Error("Unknown cosmetic token in trade");
  }

  const operatorWallet = getCosmeticsOperatorAddress();
  if (!ethers.isAddress(operatorWallet || "")) {
    throw new Error("Cosmetics trade operator is not configured");
  }

  const [ownerApproved, offererApproved] = await Promise.all([
    isCosmeticsOperatorApproved(ownerWallet, operatorWallet),
    isCosmeticsOperatorApproved(otherWallet, operatorWallet),
  ]);
  if (!ownerApproved || !offererApproved) {
    throw new Error("Both traders must enable NFT trade approval before accepting the offer");
  }

  const [ownerHasListedItem, offererHasOfferedItem, offererHasListedItem, ownerHasOfferedItem] = await Promise.all([
    getOnChainCosmeticBalance(ownerWallet, listingItemId),
    getOnChainCosmeticBalance(otherWallet, offeredItemId),
    getOnChainCosmeticBalance(otherWallet, listingItemId),
    getOnChainCosmeticBalance(ownerWallet, offeredItemId),
  ]);

  // Fully completed already: both sides already hold the swapped items.
  if (ownerHasListedItem <= 0n && offererHasOfferedItem <= 0n && offererHasListedItem > 0n && ownerHasOfferedItem > 0n) {
    return {
      operatorWallet,
      txHashes: [],
      resumed: true,
      completedAlready: true,
    };
  }

  // Offerer must still own the offered item unless swap already fully completed.
  if (offererHasOfferedItem <= 0n && ownerHasOfferedItem <= 0n) {
    throw new Error("Offerer no longer owns the offered NFT");
  }

  const txHashes = [];

  // If the listing item is still with the owner, do the first leg.
  if (ownerHasListedItem > 0n) {
    const { tx: firstTx } = await sendCosmeticsAdminTransaction(
      cosmeticsWriteInterface.encodeFunctionData("safeTransferFrom", [
        ownerWallet,
        otherWallet,
        BigInt(listingTokenId),
        1n,
        "0x",
      ])
    );
    txHashes.push(firstTx.hash);

    await db.query(
      `
      INSERT IGNORE INTO cosmetic_transfers
        (tx_hash, chain_id, item_id, token_id, from_wallet, to_wallet, operator_wallet, amount, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        firstTx.hash,
        COSMETICS_CONFIG.chainId,
        listingItemId,
        listingTokenId,
        ownerWallet,
        otherWallet,
        operatorWallet,
        JSON.stringify({ reason: "trade_swap", leg: "listing_to_offerer" }),
      ]
    );
  } else if (offererHasListedItem <= 0n) {
    throw new Error("Listing owner no longer owns the listed NFT");
  }

  const ownerHasOfferedAfterFirst = await getOnChainCosmeticBalance(ownerWallet, offeredItemId);
  if (ownerHasOfferedAfterFirst <= 0n) {
    if (offererHasOfferedItem <= 0n) {
      return {
        operatorWallet,
        txHashes,
        resumed: txHashes.length > 0,
      };
    }

    const { tx: secondTx } = await sendCosmeticsAdminTransaction(
      cosmeticsWriteInterface.encodeFunctionData("safeTransferFrom", [
        otherWallet,
        ownerWallet,
        BigInt(offeredTokenId),
        1n,
        "0x",
      ])
    );
    txHashes.push(secondTx.hash);

    await db.query(
      `
      INSERT IGNORE INTO cosmetic_transfers
        (tx_hash, chain_id, item_id, token_id, from_wallet, to_wallet, operator_wallet, amount, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        secondTx.hash,
        COSMETICS_CONFIG.chainId,
        offeredItemId,
        offeredTokenId,
        otherWallet,
        ownerWallet,
        operatorWallet,
        JSON.stringify({ reason: "trade_swap", leg: "offerer_to_listing_owner" }),
      ]
    );
  }

  const [finalOwnerListed, finalOffererOffered, finalOffererListed, finalOwnerOffered] = await Promise.all([
    getOnChainCosmeticBalance(ownerWallet, listingItemId),
    getOnChainCosmeticBalance(otherWallet, offeredItemId),
    getOnChainCosmeticBalance(otherWallet, listingItemId),
    getOnChainCosmeticBalance(ownerWallet, offeredItemId),
  ]);
  if (!(finalOwnerListed <= 0n && finalOffererOffered <= 0n && finalOffererListed > 0n && finalOwnerOffered > 0n)) {
    throw new Error("Trade swap did not complete successfully on-chain");
  }

  return {
    operatorWallet,
    txHashes,
    resumed: txHashes.length > 0,
  };
}

async function buildTradeOffersForListing(listingId) {
  const rows = await q(
    `
    SELECT id, listing_id, offerer_wallet, offered_item_id, note, offer_status, created_at, updated_at
    FROM trade_offers
    WHERE listing_id = ?
    ORDER BY id DESC
    `,
    [listingId]
  );

  return Promise.all(
    rows.map(async (row) => {
      const offerer = await buildCommunityUserSummary(row.offerer_wallet);
      return {
        id: Number(row.id),
        listingId: Number(row.listing_id),
        offererWallet: row.offerer_wallet,
        offeredItemId: row.offered_item_id,
        note: row.note || "",
        status: row.offer_status,
        createdAt: toIsoMaybe(row.created_at),
        updatedAt: toIsoMaybe(row.updated_at),
        offerer,
        offeredItem: getAvatarItemById(row.offered_item_id),
      };
    })
  );
}

async function buildTradeListing(row, viewerWallet = null) {
  const owner = await buildCommunityUserSummary(row.owner_wallet);
  const offers = await buildTradeOffersForListing(row.id);
  const viewer = normalizeWalletAddress(viewerWallet);

  return {
    id: Number(row.id),
    ownerWallet: row.owner_wallet,
    itemId: row.item_id,
    note: row.note || "",
    status: row.listing_status,
    createdAt: toIsoMaybe(row.created_at),
    updatedAt: toIsoMaybe(row.updated_at),
    owner,
    item: getAvatarItemById(row.item_id),
    offers,
    viewerIsOwner: viewer ? viewer === normalizeWalletAddress(row.owner_wallet) : false,
  };
}

async function getTradeHubData(walletAddress = null) {
  const viewerWallet = normalizeWalletAddress(walletAddress);
  const allListingRows = await q(
    `
    SELECT id, owner_wallet, item_id, note, listing_status, created_at, updated_at
    FROM trade_listings
    ORDER BY id DESC
    `
  );
  const listingRows = allListingRows.filter((row) => row.listing_status === "open");
  const operatorAddress = getCosmeticsOperatorAddress();
  const viewerTradeApproved =
    viewerWallet && operatorAddress ? await isCosmeticsOperatorApproved(viewerWallet, operatorAddress) : false;

  const openListings = await Promise.all(
    listingRows.map((row) => buildTradeListing(row, viewerWallet))
  );

  const myListings = viewerWallet
    ? await Promise.all(
        allListingRows
          .filter((listing) => normalizeWalletAddress(listing.owner_wallet) === viewerWallet)
          .map((listing) => buildTradeListing(listing, viewerWallet))
      )
    : [];

  const availableListings = viewerWallet
    ? openListings.filter((listing) => normalizeWalletAddress(listing.ownerWallet) !== viewerWallet)
    : openListings;

  const incomingOffers = myListings
    .filter((listing) => listing.status === "open")
    .flatMap((listing) =>
      listing.offers
        .filter((offer) => offer.status === "pending")
        .map((offer) => ({
          ...offer,
          listing,
        }))
    );

  let outgoingOffers = [];
  if (viewerWallet) {
    const outgoingRows = await q(
      `
      SELECT id, listing_id, offerer_wallet, offered_item_id, note, offer_status, created_at, updated_at
      FROM trade_offers
      WHERE offerer_wallet = ?
      ORDER BY id DESC
      `,
      [viewerWallet]
    );
    outgoingOffers = await Promise.all(
      outgoingRows.map(async (row) => {
        const listingRow = allListingRows.find((entry) => Number(entry.id) === Number(row.listing_id));
        return {
          id: Number(row.id),
          listingId: Number(row.listing_id),
          offererWallet: row.offerer_wallet,
          offeredItemId: row.offered_item_id,
          note: row.note || "",
          status: row.offer_status,
          createdAt: toIsoMaybe(row.created_at),
          updatedAt: toIsoMaybe(row.updated_at),
          offeredItem: getAvatarItemById(row.offered_item_id),
          listing: listingRow ? await buildTradeListing(listingRow, viewerWallet) : null,
        };
      })
    );
  }

  return {
    openListings: availableListings,
    myListings,
    incomingOffers,
    outgoingOffers,
    cosmeticsContractAddress: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.contractAddress : null,
    cosmeticsChainId: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.chainId : null,
    tradeOperatorAddress: operatorAddress,
    tradeApprovalRequired: Boolean(operatorAddress),
    viewerTradeApproved,
  };
}

// ----------------------------------------------------
// VALIDATION (Zod)
// ----------------------------------------------------
const EventSchema = z.object({
  walletAddress: z.string().min(6),
  tripType: z.enum(["bus", "rail", "monorail", "park&ride"]),
  distanceKm: z.number().min(0).max(200).optional(),
  routeId: z.string().optional(),
  stopId: z.string().optional(),
  ts: z.number().optional(),
  source: z.string().optional(),
});

const AvatarLayoutSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  layout: z.any(),
  savedBySource: z.string().min(1).max(32).optional(),
});

const UserProfileSchema = z.object({
  displayName: z.union([z.string(), z.null()]).optional(),
});

const UserFriendSchema = z.object({
  friendWallet: z.string().min(3).max(100),
});

const GroupCreateSchema = z.object({
  ownerWallet: z.string().min(3).max(100),
  name: z.string().min(2).max(48),
  description: z.string().max(240).optional().nullable(),
});

const GroupInviteSchema = z.object({
  inviterWallet: z.string().min(3).max(100),
  inviteeWallet: z.string().min(3).max(100),
});

const WalletActionSchema = z.object({
  walletAddress: z.string().min(3).max(100),
});

const GroupCrownClaimSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  txHash: z.string().min(66).max(66),
  chainId: z.number().int().positive(),
});

const GroupRoleUpdateSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  targetWallet: z.string().min(3).max(100),
  role: z.enum(["admin", "member"]),
});

const GroupDeleteSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  confirm: z.literal("DELETE"),
});

const OutfitPresetSchema = z.object({
  presetName: z.string().min(2).max(48),
  layout: z.any(),
});

const LikeActionSchema = z.object({
  likerWallet: z.string().min(3).max(100),
  liked: z.boolean(),
});

const GroupChallengeSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  title: z.string().min(2).max(80),
  targetKm: z.number().positive().max(100000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

const TradeListingSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  itemId: z.string().min(1).max(100),
  note: z.string().max(240).optional().nullable(),
});

const TradeOfferSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  offeredItemId: z.string().min(1).max(100),
  note: z.string().max(240).optional().nullable(),
});

const TradeActionSchema = z.object({
  walletAddress: z.string().min(3).max(100),
});

const ShopPurchaseSchema = z.object({
  walletAddress: z.string().min(3).max(100),
  itemId: z.string().min(1).max(100),
  itemName: z.string().min(1).max(150).optional(),
  slotName: z.string().min(1).max(32).optional(),
  priceTokens: z.number().min(0).max(1000000),
  metadata: z.any().optional(),
});

const CosmeticTransferConfirmSchema = z.object({
  fromWallet: z.string().min(3).max(100),
  toWallet: z.string().min(3).max(100),
  itemId: z.string().min(1).max(100),
  txHash: z.string().min(66).max(66),
  chainId: z.number().int().positive(),
});

const ClaimCreateSchema = z.object({
  amountTokens: z.number().positive(),
});

// ----------------------------------------------------
// DB / COMPUTE HELPERS
// ----------------------------------------------------
async function pingDb() {
  const rows = await q("SELECT 1 AS ok");
  return rows?.[0]?.ok === 1;
}

async function insertEventToDb(body) {
  const event_id = eventId();
  const wallet_address = normalizeWalletAddress(body.walletAddress);
  const trip_type = normalizeTripTypeToDb(body.tripType);
  const distance_km =
    typeof body.distanceKm === "number" && Number.isFinite(body.distanceKm)
      ? body.distanceKm
      : null;
  const route_id = body.routeId ?? null;
  const stop_id = body.stopId ?? null;
  const source = body.source ?? "unknown";
  const event_ts_ms = typeof body.ts === "number" ? body.ts : null;

  const eventTimeDate = event_ts_ms ? new Date(event_ts_ms) : new Date();
  const event_time_sql = eventTimeDate.toISOString().slice(0, 19).replace("T", " ");

  await db.query(
    `
    INSERT INTO events
      (event_id, wallet_address, trip_type, distance_km, route_id, stop_id, source, event_ts_ms, event_time, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [event_id, wallet_address, trip_type, distance_km, route_id, stop_id, source, event_ts_ms, event_time_sql]
  );

  return { eventId: event_id };
}

async function getRecentEvents(limit = 50) {
  const l = clamp(Number(limit || 50), 1, 200);
  const rows = await q(
    `
    SELECT id, event_id, wallet_address, trip_type, distance_km, route_id, stop_id, source, event_ts_ms, event_time, created_at
    FROM events
    ORDER BY id DESC
    LIMIT ?
    `,
    [l]
  );
  return rows.map(mapDbEventRowToApi);
}

async function getAllEventsForStats({ wallet = null } = {}) {
  const normalizedWallet = wallet ? normalizeWalletAddress(wallet) : null;
  const hasWalletFilter = normalizedWallet && normalizedWallet.length >= 6;
  const rows = await q(
    `
    SELECT id, event_id, wallet_address, trip_type, distance_km, route_id, stop_id, source, event_ts_ms, event_time, created_at
    FROM events
    ${hasWalletFilter ? "WHERE wallet_address = ?" : ""}
    ORDER BY id DESC
    `,
    hasWalletFilter ? [normalizedWallet] : []
  );
  return rows.map(mapDbEventRowToApi);
}

async function computeWalletRewards(wallet, options = {}) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const includeOnChainBalance = options?.includeOnChainBalance !== false;

  const eventRows = await q(
    `
    SELECT wallet_address, trip_type, distance_km, event_ts_ms, event_time
    FROM events
    WHERE wallet_address = ?
    ORDER BY id DESC
    `,
    [normalizedWallet]
  );

  let earned = 0;
  let eventsCount = 0;
  let distanceKm = 0;
  let co2SavedKg = 0;
  const tripsByType = { bus: 0, rail: 0, monorail: 0, "park&ride": 0 };

  for (const row of eventRows) {
    const e = {
      walletAddress: row.wallet_address,
      tripType: normalizeTripTypeFromDb(row.trip_type),
      distanceKm: row.distance_km == null ? null : Number(row.distance_km),
      ts: row.event_ts_ms == null ? null : Number(row.event_ts_ms),
      eventTime: row.event_time instanceof Date ? row.event_time.toISOString() : row.event_time,
    };

    eventsCount++;
    tripsByType[e.tripType] = (tripsByType[e.tripType] || 0) + 1;
    if (typeof e.distanceKm === "number") distanceKm += e.distanceKm;
    earned += rewardTokensForEvent(e);
    co2SavedKg += co2SavedKgForEvent(e);
  }

  const spentRows = await q(
    `
    SELECT COALESCE(SUM(price_tokens), 0) AS spent_tokens
    FROM shop_purchases
    WHERE wallet_address = ?
    `,
    [normalizedWallet]
  );
  const spentTokens = Number(spentRows?.[0]?.spent_tokens || 0);

  const claimRows = await q(
    `
    SELECT COALESCE(SUM(amount_tokens), 0) AS claimed_tokens
    FROM reward_claims
    WHERE wallet_address = ?
      AND claim_status IN (${CLAIM_RESERVED_STATUSES.map(() => "?").join(", ")})
    `,
    [normalizedWallet, ...CLAIM_RESERVED_STATUSES]
  );
  const claimedTokens = Number(claimRows?.[0]?.claimed_tokens || 0);

  const claimableTokens = Math.max(0, earned - claimedTokens);
  let onChainBalanceWei = 0n;
  let onChainStatus = "skipped";
  if (includeOnChainBalance && ethers.isAddress(normalizedWallet)) {
    const result = await getOnChainBalanceWei(normalizedWallet);
    onChainBalanceWei = result.wei;
    onChainStatus = result.status;
  }
  const onChainBalanceTokens = Number(ethers.formatUnits(onChainBalanceWei, GCT_DECIMALS));
  const spendableTokensOnChain = onChainBalanceTokens;

  return {
    wallet: normalizedWallet,
    token: REWARD_RULES.tokenSymbol,
    contractAddress: GCT_CONFIG.contractAddress,
    chainId: GCT_CONFIG.chainId,
    burnAddress: GCT_CONFIG.burnAddress,
    decimals: GCT_DECIMALS,
    eventsCount,
    earnedTokens: Number(earned.toFixed(3)),
    spentTokens: Number(spentTokens.toFixed(3)),
    claimedTokens: Number(claimedTokens.toFixed(3)),
    availableTokens: Number(claimableTokens.toFixed(3)),
    claimableTokens: Number(claimableTokens.toFixed(3)),
    onChainBalanceWei: onChainBalanceWei.toString(),
    onChainBalanceTokens: Number(onChainBalanceTokens.toFixed(6)),
    spendableTokensOnChain: Number(spendableTokensOnChain.toFixed(6)),
    onChainStatus,
    breakdown: {
      tripsByType,
      distanceKm: Number(distanceKm.toFixed(2)),
      co2SavedKg: Number(co2SavedKg.toFixed(3)),
    },
    rules: REWARD_RULES,
  };
}

async function getAvatarLayoutByWallet(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet || normalizedWallet.length < 6) return null;

  const rows = await q(
    `
    SELECT wallet_address, layout_json, saved_by_source, updated_at, created_at
    FROM avatar_layouts
    WHERE wallet_address = ?
    LIMIT 1
    `,
    [normalizedWallet]
  );

  if (!rows.length) return null;

  const row = rows[0];
  return {
    walletAddress: row.wallet_address,
    layout: safeJsonParse(row.layout_json, null),
    savedBySource: row.saved_by_source || "api",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function getPurchaseCountByWallet(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT COUNT(*) AS purchases_count
    FROM shop_purchases
    WHERE wallet_address = ?
    `,
    [normalizedWallet]
  );
  return Number(rows?.[0]?.purchases_count || 0);
}

async function doesWalletOwnItem(wallet, itemId) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const normalizedItemId = String(itemId || "").trim();
  if (!normalizedWallet || !normalizedItemId) return false;
  if (hasCosmeticsContractConfigured() && isTokenizedAvatarItem(normalizedItemId)) {
    const onChainBalance = await getOnChainCosmeticBalance(normalizedWallet, normalizedItemId);
    return onChainBalance > 0n;
  }
  const rows = await q(
    `
    SELECT 1 AS ok
    FROM shop_purchases
    WHERE wallet_address = ? AND item_id = ?
    LIMIT 1
    `,
    [normalizedWallet, normalizedItemId]
  );
  return rows.length > 0;
}

async function validateZeroValueOnChainActionTx(txHash, walletAddress, expectedToAddress) {
  if (!isValidTxHash(txHash)) {
    throw new Error("txHash is required and must be a valid 0x hash");
  }
  if (!(await isGctRpcReachable())) {
    throw new Error("RPC is unreachable for on-chain validation");
  }
  const provider = getGctProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error("Transaction is not mined yet");
  }
  if (receipt.status !== 1) {
    throw new Error("Transaction reverted");
  }
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    throw new Error("Transaction not found on chain");
  }

  const expectedFrom = normalizeWalletAddress(walletAddress);
  const actualFrom = normalizeWalletAddress(tx.from);
  const actualTo = normalizeWalletAddress(tx.to);
  const expectedTo = normalizeWalletAddress(expectedToAddress);

  if (actualFrom !== expectedFrom) {
    throw new Error("Transaction sender does not match the claiming wallet");
  }
  if (actualTo !== expectedTo) {
    throw new Error("Transaction target does not match the configured reward sink");
  }
  if (BigInt(tx.value || 0n) !== 0n) {
    throw new Error("Reward claim tx must have zero native value");
  }

  return {
    txHash,
    chainId: GCT_CONFIG.chainId,
  };
}

function sanitizeDisplayName(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  const value = String(rawValue).trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (value.length < 2 || value.length > 32) {
    throw new Error("Display name must be between 2 and 32 characters");
  }
  if (!/^[\p{L}\p{N} _.!?\-]+$/u.test(value)) {
    throw new Error("Display name contains unsupported characters");
  }
  return value;
}

function normalizeDisplayNameLookup(rawValue) {
  return String(rawValue || "").trim().replace(/^@+/, "").toLowerCase();
}

function sanitizeMessageText(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("Message cannot be empty");
  }
  if (value.length > 500) {
    throw new Error("Message cannot be longer than 500 characters");
  }
  return value;
}

async function ensureUserProfilesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      wallet_address VARCHAR(42) NOT NULL,
      display_name VARCHAR(32) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_user_profiles_wallet (wallet_address),
      KEY idx_user_profiles_display_name (display_name),
      KEY idx_user_profiles_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureFriendRequestsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      requester_wallet VARCHAR(42) NOT NULL,
      addressee_wallet VARCHAR(42) NOT NULL,
      status ENUM('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
      responded_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_friend_request_pair (requester_wallet, addressee_wallet),
      KEY idx_friend_requests_requester (requester_wallet),
      KEY idx_friend_requests_addressee (addressee_wallet),
      KEY idx_friend_requests_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureGroupsTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS groups_social (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      owner_wallet VARCHAR(42) NOT NULL,
      name VARCHAR(48) NOT NULL,
      description VARCHAR(240) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_groups_social_owner (owner_wallet),
      KEY idx_groups_social_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      wallet_address VARCHAR(42) NOT NULL,
      member_role ENUM('owner','member') NOT NULL DEFAULT 'member',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_group_members_group_wallet (group_id, wallet_address),
      KEY idx_group_members_group (group_id),
      KEY idx_group_members_wallet (wallet_address)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_invites (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      inviter_wallet VARCHAR(42) NOT NULL,
      invitee_wallet VARCHAR(42) NOT NULL,
      status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
      responded_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_group_invites_group_invitee (group_id, invitee_wallet),
      KEY idx_group_invites_group (group_id),
      KEY idx_group_invites_invitee (invitee_wallet),
      KEY idx_group_invites_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureDirectMessagesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sender_wallet VARCHAR(42) NOT NULL,
      recipient_wallet VARCHAR(42) NOT NULL,
      message_text VARCHAR(500) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_direct_messages_sender (sender_wallet),
      KEY idx_direct_messages_recipient (recipient_wallet),
      KEY idx_direct_messages_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureGroupMessagesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      sender_wallet VARCHAR(42) NOT NULL,
      message_text VARCHAR(500) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_group_messages_group (group_id),
      KEY idx_group_messages_sender (sender_wallet),
      KEY idx_group_messages_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureAvatarSocialFeatureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS outfit_presets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      wallet_address VARCHAR(42) NOT NULL,
      preset_name VARCHAR(48) NOT NULL,
      layout_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_outfit_presets_wallet (wallet_address),
      KEY idx_outfit_presets_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      wallet_address VARCHAR(42) NOT NULL,
      last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_active_source VARCHAR(48) NULL,
      PRIMARY KEY (wallet_address),
      KEY idx_user_presence_active (last_active_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS direct_message_reads (
      reader_wallet VARCHAR(42) NOT NULL,
      other_wallet VARCHAR(42) NOT NULL,
      last_read_message_id BIGINT UNSIGNED NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (reader_wallet, other_wallet),
      KEY idx_direct_message_reads_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_message_reads (
      group_id BIGINT UNSIGNED NOT NULL,
      reader_wallet VARCHAR(42) NOT NULL,
      last_read_message_id BIGINT UNSIGNED NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, reader_wallet),
      KEY idx_group_message_reads_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_challenges (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(80) NOT NULL,
      target_km DECIMAL(12,2) NOT NULL,
      created_by_wallet VARCHAR(42) NOT NULL,
      starts_at DATETIME NULL,
      ends_at DATETIME NULL,
      completed_at DATETIME NULL,
      bonus_points DECIMAL(12,2) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_group_challenges_group (group_id),
      KEY idx_group_challenges_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_likes (
      target_wallet VARCHAR(42) NOT NULL,
      liker_wallet VARCHAR(42) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_wallet, liker_wallet),
      KEY idx_profile_likes_liker (liker_wallet)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS outfit_likes (
      target_wallet VARCHAR(42) NOT NULL,
      liker_wallet VARCHAR(42) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (target_wallet, liker_wallet),
      KEY idx_outfit_likes_liker (liker_wallet)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS group_reward_grants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      group_id BIGINT UNSIGNED NOT NULL,
      wallet_address VARCHAR(42) NOT NULL,
      reward_code VARCHAR(64) NOT NULL,
      reward_item_id VARCHAR(100) NULL,
      granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata_json LONGTEXT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_group_reward_unique (group_id, wallet_address, reward_code),
      KEY idx_group_reward_wallet (wallet_address),
      KEY idx_group_reward_code (reward_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS cosmetic_transfers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tx_hash VARCHAR(66) NOT NULL,
      chain_id BIGINT UNSIGNED NOT NULL,
      item_id VARCHAR(100) NOT NULL,
      token_id BIGINT UNSIGNED NOT NULL,
      from_wallet VARCHAR(42) NOT NULL,
      to_wallet VARCHAR(42) NOT NULL,
      operator_wallet VARCHAR(42) NULL,
      amount INT UNSIGNED NOT NULL DEFAULT 1,
      metadata_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_cosmetic_transfers_tx (tx_hash),
      KEY idx_cosmetic_transfers_from (from_wallet),
      KEY idx_cosmetic_transfers_to (to_wallet),
      KEY idx_cosmetic_transfers_item (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS trade_listings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      owner_wallet VARCHAR(42) NOT NULL,
      item_id VARCHAR(100) NOT NULL,
      note VARCHAR(240) NULL,
      listing_status ENUM('open','accepted','cancelled') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_trade_listings_owner (owner_wallet),
      KEY idx_trade_listings_status (listing_status),
      KEY idx_trade_listings_item (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS trade_offers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      listing_id BIGINT UNSIGNED NOT NULL,
      offerer_wallet VARCHAR(42) NOT NULL,
      offered_item_id VARCHAR(100) NOT NULL,
      note VARCHAR(240) NULL,
      offer_status ENUM('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_trade_offers_listing (listing_id),
      KEY idx_trade_offers_offerer (offerer_wallet),
      KEY idx_trade_offers_status (offer_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      wallet_address VARCHAR(42) NOT NULL,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(120) NOT NULL,
      body VARCHAR(255) NOT NULL,
      ref_type VARCHAR(32) NULL,
      ref_id BIGINT UNSIGNED NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_notifications_wallet (wallet_address),
      KEY idx_notifications_read (wallet_address, is_read),
      KEY idx_notifications_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureGroupChallengeColumns();
  await ensureGroupMemberRoleEnum();
}

async function safeAlter(sql) {
  try {
    await db.query(sql);
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (
      msg.includes("duplicate column") ||
      msg.includes("duplicate key") ||
      msg.includes("check that column/key exists")
    ) {
      return;
    }
    throw e;
  }
}

async function ensureGroupChallengeColumns() {
  await safeAlter(`ALTER TABLE group_challenges ADD COLUMN starts_at DATETIME NULL`);
  await safeAlter(`ALTER TABLE group_challenges ADD COLUMN ends_at DATETIME NULL`);
  await safeAlter(`ALTER TABLE group_challenges ADD COLUMN completed_at DATETIME NULL`);
  await safeAlter(`ALTER TABLE group_challenges ADD COLUMN bonus_points DECIMAL(12,2) NULL`);
}

async function ensureGroupMemberRoleEnum() {
  await db.query(`
    ALTER TABLE group_members
    MODIFY COLUMN member_role ENUM('owner','admin','member') NOT NULL DEFAULT 'member'
  `);
}

async function getUserProfileByWallet(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet || normalizedWallet.length < 6) return null;

  const rows = await q(
    `
    SELECT wallet_address, display_name, created_at, updated_at
    FROM user_profiles
    WHERE wallet_address = ?
    LIMIT 1
    `,
    [normalizedWallet]
  );

  if (!rows.length) return null;

  const row = rows[0];
  return {
    walletAddress: row.wallet_address,
    displayName: row.display_name || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function findWalletByDisplayName(displayName) {
  const normalizedDisplayName = normalizeDisplayNameLookup(displayName);
  if (!normalizedDisplayName) return null;
  const rows = await q(
    `
    SELECT wallet_address, display_name
    FROM user_profiles
    WHERE LOWER(display_name) = ?
    LIMIT 1
    `,
    [normalizedDisplayName]
  );
  if (!rows.length) return null;
  return {
    walletAddress: rows[0].wallet_address,
    displayName: rows[0].display_name || null,
  };
}

async function resolveWalletOrDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Wallet or username is required");

  const directWallet = normalizeWalletAddress(raw);
  if (directWallet.length >= 6 && (directWallet.startsWith("0x") || directWallet.includes("user"))) {
    return directWallet;
  }

  const found = await findWalletByDisplayName(raw);
  if (found?.walletAddress) return found.walletAddress;
  throw new Error("User not found by that wallet or community name");
}

async function upsertUserProfile(wallet, displayName) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const normalizedDisplayName = sanitizeDisplayName(displayName);

  if (normalizedDisplayName) {
    const existing = await findWalletByDisplayName(normalizedDisplayName);
    if (existing && normalizeWalletAddress(existing.walletAddress) !== normalizedWallet) {
      throw new Error("That community name is already taken");
    }
  }

  await db.query(
    `
    INSERT INTO user_profiles (wallet_address, display_name, created_at, updated_at)
    VALUES (?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      updated_at = NOW()
    `,
    [normalizedWallet, normalizedDisplayName]
  );

  return getUserProfileByWallet(normalizedWallet);
}

async function touchUserPresence(wallet, source = "api") {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) return;
  await db.query(
    `
    INSERT INTO user_presence (wallet_address, last_active_at, last_active_source)
    VALUES (?, NOW(), ?)
    ON DUPLICATE KEY UPDATE
      last_active_at = NOW(),
      last_active_source = VALUES(last_active_source)
    `,
    [normalizedWallet, String(source || "api").slice(0, 48)]
  );
}

async function getPresenceByWallet(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT wallet_address, last_active_at, last_active_source
    FROM user_presence
    WHERE wallet_address = ?
    LIMIT 1
    `,
    [normalizedWallet]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const iso = toIsoMaybe(row.last_active_at);
  const lastMs = iso ? new Date(iso).getTime() : 0;
  return {
    walletAddress: row.wallet_address,
    lastActiveAt: iso,
    lastActiveSource: row.last_active_source || null,
    isOnline: lastMs > 0 && Date.now() - lastMs <= 5 * 60 * 1000,
  };
}

function sanitizePresetName(rawValue) {
  const value = String(rawValue || "").trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 48) {
    throw new Error("Preset name must be between 2 and 48 characters");
  }
  return value;
}

async function getOutfitPresets(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id, preset_name, layout_json, created_at, updated_at
    FROM outfit_presets
    WHERE wallet_address = ?
    ORDER BY updated_at DESC, created_at DESC
    `,
    [normalizedWallet]
  );
  return rows.map((row) => {
    let layout = null;
    try {
      layout = row.layout_json ? JSON.parse(row.layout_json) : null;
    } catch {}
    return {
      id: Number(row.id),
      name: row.preset_name,
      layout,
      createdAt: toIsoMaybe(row.created_at),
      updatedAt: toIsoMaybe(row.updated_at),
    };
  });
}

async function saveOutfitPreset(wallet, presetName, layout) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const name = sanitizePresetName(presetName);
  const payload = JSON.stringify(layout || {});
  const result = await db.query(
    `
    INSERT INTO outfit_presets (wallet_address, preset_name, layout_json, created_at, updated_at)
    VALUES (?, ?, ?, NOW(), NOW())
    `,
    [normalizedWallet, name, payload]
  );
  return Number(result.insertId);
}

async function deleteOutfitPreset(wallet, presetId) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  await db.query(
    `
    DELETE FROM outfit_presets
    WHERE id = ? AND wallet_address = ?
    `,
    [presetId, normalizedWallet]
  );
}

async function getLikeSnapshot(targetWallet, viewerWallet = "") {
  const target = normalizeWalletAddress(targetWallet);
  const viewer = normalizeWalletAddress(viewerWallet);
  const [profileCountRows, outfitCountRows, profileViewerRows, outfitViewerRows] = await Promise.all([
    q(`SELECT COUNT(*) AS c FROM profile_likes WHERE target_wallet = ?`, [target]),
    q(`SELECT COUNT(*) AS c FROM outfit_likes WHERE target_wallet = ?`, [target]),
    viewer ? q(`SELECT 1 AS ok FROM profile_likes WHERE target_wallet = ? AND liker_wallet = ? LIMIT 1`, [target, viewer]) : Promise.resolve([]),
    viewer ? q(`SELECT 1 AS ok FROM outfit_likes WHERE target_wallet = ? AND liker_wallet = ? LIMIT 1`, [target, viewer]) : Promise.resolve([]),
  ]);
  return {
    profileLikes: Number(profileCountRows[0]?.c || 0),
    outfitLikes: Number(outfitCountRows[0]?.c || 0),
    viewerLikedProfile: Boolean(profileViewerRows.length),
    viewerLikedOutfit: Boolean(outfitViewerRows.length),
  };
}

async function setProfileLike(targetWallet, likerWallet, liked) {
  const target = normalizeWalletAddress(targetWallet);
  const liker = normalizeWalletAddress(likerWallet);
  if (!target || !liker || target === liker) throw new Error("Invalid like request");
  if (liked) {
    await db.query(
      `INSERT IGNORE INTO profile_likes (target_wallet, liker_wallet, created_at) VALUES (?, ?, NOW())`,
      [target, liker]
    );
  } else {
    await db.query(`DELETE FROM profile_likes WHERE target_wallet = ? AND liker_wallet = ?`, [target, liker]);
  }
  return getLikeSnapshot(target, liker);
}

async function setOutfitLike(targetWallet, likerWallet, liked) {
  const target = normalizeWalletAddress(targetWallet);
  const liker = normalizeWalletAddress(likerWallet);
  if (!target || !liker || target === liker) throw new Error("Invalid like request");
  if (liked) {
    await db.query(
      `INSERT IGNORE INTO outfit_likes (target_wallet, liker_wallet, created_at) VALUES (?, ?, NOW())`,
      [target, liker]
    );
  } else {
    await db.query(`DELETE FROM outfit_likes WHERE target_wallet = ? AND liker_wallet = ?`, [target, liker]);
  }
  return getLikeSnapshot(target, liker);
}

function sanitizeGroupName(rawValue) {
  const value = String(rawValue || "").trim().replace(/\s+/g, " ");
  if (value.length < 2 || value.length > 48) {
    throw new Error("Group name must be between 2 and 48 characters");
  }
  return value;
}

function sanitizeGroupDescription(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  const value = String(rawValue || "").trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (value.length > 240) {
    throw new Error("Group description must be at most 240 characters");
  }
  return value;
}

function toIsoMaybe(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function dedupeWalletRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = normalizeWalletAddress(row.walletAddress);
    if (!key) continue;
    const previous = map.get(key);
    if (!previous || String(row.createdAt || "") > String(previous.createdAt || "")) {
      map.set(key, {
        walletAddress: key,
        createdAt: row.createdAt || null,
      });
    }
  }
  return [...map.values()];
}

function communityDisplaySortValue(entry) {
  const displayName = typeof entry?.customDisplayName === "string" ? entry.customDisplayName.trim() : "";
  if (displayName) return displayName.toLowerCase();
  return String(entry?.walletAddress || "").toLowerCase();
}

async function getAcceptedFriendWallets(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const acceptedRows = await q(
    `
      SELECT
        CASE
          WHEN requester_wallet = ? THEN addressee_wallet
          ELSE requester_wallet
        END AS wallet_address,
        updated_at AS created_at
      FROM friend_requests
      WHERE status = 'accepted'
        AND (requester_wallet = ? OR addressee_wallet = ?)
      `,
    [normalizedWallet, normalizedWallet, normalizedWallet]
  );

  return dedupeWalletRows(
    acceptedRows.map((row) => ({
      walletAddress: row.wallet_address,
      createdAt: toIsoMaybe(row.created_at),
    }))
  );
}

async function areFriends(walletA, walletB) {
  const a = normalizeWalletAddress(walletA);
  const b = normalizeWalletAddress(walletB);
  const rows = await getAcceptedFriendWallets(a);
  return rows.some((row) => row.walletAddress === b);
}

async function buildCommunityUserSummary(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const [rewards, avatar, purchasesCount, userProfile, presence] = await Promise.all([
    computeWalletRewards(normalizedWallet, { includeOnChainBalance: false }),
    getAvatarLayoutByWallet(normalizedWallet),
    getPurchaseCountByWallet(normalizedWallet),
    getUserProfileByWallet(normalizedWallet),
    getPresenceByWallet(normalizedWallet),
  ]);

  return {
    walletAddress: normalizedWallet,
    displayName: userProfile?.displayName || normalizedWallet,
    customDisplayName: userProfile?.displayName || null,
    rewards,
    avatar: avatar
      ? {
          exists: true,
          ...avatar,
        }
      : {
          exists: false,
          walletAddress: normalizedWallet,
          layout: null,
        },
    purchasesCount,
    presence: presence || {
      walletAddress: normalizedWallet,
      lastActiveAt: null,
      lastActiveSource: null,
      isOnline: false,
    },
  };
}

async function buildFriendProfiles(wallet) {
  const friendRows = await getAcceptedFriendWallets(wallet);
  const friends = await Promise.all(
    friendRows.map(async (row) => {
      const profile = await buildCommunityUserSummary(row.walletAddress);
      return {
        ...profile,
        friendedAt: row.createdAt,
      };
    })
  );
  return friends;
}

async function getIncomingFriendRequestRows(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id, requester_wallet, created_at
    FROM friend_requests
    WHERE addressee_wallet = ? AND status = 'pending'
    ORDER BY created_at DESC
    `,
    [normalizedWallet]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    walletAddress: row.requester_wallet,
    createdAt: toIsoMaybe(row.created_at),
  }));
}

async function getOutgoingFriendRequestRows(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id, addressee_wallet, created_at
    FROM friend_requests
    WHERE requester_wallet = ? AND status = 'pending'
    ORDER BY created_at DESC
    `,
    [normalizedWallet]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    walletAddress: row.addressee_wallet,
    createdAt: toIsoMaybe(row.created_at),
  }));
}

async function buildRequestProfiles(requestRows) {
  return Promise.all(
    requestRows.map(async (row) => {
      const profile = await buildCommunityUserSummary(row.walletAddress);
      return {
        requestId: row.id,
        createdAt: row.createdAt,
        ...profile,
      };
    })
  );
}

async function getFriendSocialData(wallet) {
  const [friends, incomingRows, outgoingRows] = await Promise.all([
    buildFriendProfiles(wallet),
    getIncomingFriendRequestRows(wallet),
    getOutgoingFriendRequestRows(wallet),
  ]);
  const [incomingRequests, outgoingRequests] = await Promise.all([
    buildRequestProfiles(incomingRows),
    buildRequestProfiles(outgoingRows),
  ]);
  return { friends, incomingRequests, outgoingRequests };
}

// ----------------------------------------------------
// NOTIFICATIONS
// ----------------------------------------------------
async function notify(walletAddress, { type, title, body, refType = null, refId = null }) {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet || wallet.length < 6) return;
  try {
    await db.query(
      `INSERT INTO notifications (wallet_address, type, title, body, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [wallet, type, title.slice(0, 120), body.slice(0, 255), refType, refId ?? null]
    );
  } catch (e) {
    console.warn("[notify] Failed to insert notification:", e?.message || e);
  }
}

async function sendFriendRequest(wallet, friendWallet) {
  const requester = normalizeWalletAddress(wallet);
  const addressee = await resolveWalletOrDisplayName(friendWallet);

  if (!requester || requester.length < 6) throw new Error("Invalid wallet address");
  if (!addressee || addressee.length < 6) throw new Error("Invalid friend wallet address");
  if (requester === addressee) throw new Error("You cannot send a friend request to yourself");
  if (await areFriends(requester, addressee)) {
    throw new Error("You are already friends");
  }

  const reversePending = await q(
    `
    SELECT id
    FROM friend_requests
    WHERE requester_wallet = ? AND addressee_wallet = ? AND status = 'pending'
    LIMIT 1
    `,
    [addressee, requester]
  );
  if (reversePending.length) {
    await acceptFriendRequest(requester, Number(reversePending[0].id));
    return { autoAccepted: true };
  }

  await db.query(
    `
    INSERT INTO friend_requests (requester_wallet, addressee_wallet, status, responded_at, created_at, updated_at)
    VALUES (?, ?, 'pending', NULL, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      status = 'pending',
      responded_at = NULL,
      updated_at = NOW()
    `,
    [requester, addressee]
  );

  await notify(addressee, {
    type: "friend_request",
    title: "New friend request",
    body: `${requester.slice(0, 6)}...${requester.slice(-4)} sent you a friend request.`,
    refType: "friend_request",
  });

  return { autoAccepted: false };
}

async function acceptFriendRequest(actorWallet, requestId) {
  const actor = normalizeWalletAddress(actorWallet);
  const rows = await q(
    `
    SELECT id, requester_wallet, addressee_wallet, status
    FROM friend_requests
    WHERE id = ?
    LIMIT 1
    `,
    [requestId]
  );
  if (!rows.length) throw new Error("Friend request not found");
  const row = rows[0];
  if (normalizeWalletAddress(row.addressee_wallet) !== actor) {
    throw new Error("Only the recipient can accept this request");
  }
  if (row.status !== "pending") throw new Error("Friend request is no longer pending");

  await db.query(
    `
    UPDATE friend_requests
    SET status = 'accepted',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
    `,
    [requestId]
  );
}

async function rejectFriendRequest(actorWallet, requestId) {
  const actor = normalizeWalletAddress(actorWallet);
  const rows = await q(
    `
    SELECT id, addressee_wallet, status
    FROM friend_requests
    WHERE id = ?
    LIMIT 1
    `,
    [requestId]
  );
  if (!rows.length) throw new Error("Friend request not found");
  const row = rows[0];
  if (normalizeWalletAddress(row.addressee_wallet) !== actor) {
    throw new Error("Only the recipient can reject this request");
  }
  if (row.status !== "pending") throw new Error("Friend request is no longer pending");

  await db.query(
    `
    UPDATE friend_requests
    SET status = 'rejected',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
    `,
    [requestId]
  );
}

async function cancelFriendRequest(actorWallet, requestId) {
  const actor = normalizeWalletAddress(actorWallet);
  const rows = await q(
    `
    SELECT id, requester_wallet, status
    FROM friend_requests
    WHERE id = ?
    LIMIT 1
    `,
    [requestId]
  );
  if (!rows.length) throw new Error("Friend request not found");
  const row = rows[0];
  if (normalizeWalletAddress(row.requester_wallet) !== actor) {
    throw new Error("Only the requester can cancel this request");
  }
  if (row.status !== "pending") throw new Error("Friend request is no longer pending");

  await db.query(
    `
    UPDATE friend_requests
    SET status = 'cancelled',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
    `,
    [requestId]
  );
}

async function removeFriendship(wallet, friendWallet) {
  const a = normalizeWalletAddress(wallet);
  const b = normalizeWalletAddress(friendWallet);
  await db.query(
    `
    UPDATE friend_requests
    SET status = 'cancelled',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE status = 'accepted'
      AND (
        (requester_wallet = ? AND addressee_wallet = ?)
        OR
        (requester_wallet = ? AND addressee_wallet = ?)
      )
    `,
    [a, b, b, a]
  );
}

async function createGroup(ownerWallet, name, description) {
  const owner = normalizeWalletAddress(ownerWallet);
  const groupName = sanitizeGroupName(name);
  const groupDescription = sanitizeGroupDescription(description);
  const result = await db.query(
    `
    INSERT INTO groups_social (owner_wallet, name, description, created_at, updated_at)
    VALUES (?, ?, ?, NOW(), NOW())
    `,
    [owner, groupName, groupDescription]
  );
  const groupId = Number(result.insertId);
  await db.query(
    `
    INSERT INTO group_members (group_id, wallet_address, member_role, created_at)
    VALUES (?, ?, 'owner', NOW())
    ON DUPLICATE KEY UPDATE member_role = 'owner'
    `,
    [groupId, owner]
  );
  return groupId;
}

async function getGroupRowsForWallet(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  return q(
    `
    SELECT g.id, g.owner_wallet, g.name, g.description, g.created_at, g.updated_at, gm.member_role
    FROM groups_social g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.wallet_address = ?
    ORDER BY g.updated_at DESC, g.created_at DESC
    `,
    [normalizedWallet]
  );
}

async function buildGroupDetails(groupId, viewerWallet = "") {
  const groupRows = await q(
    `
    SELECT id, owner_wallet, name, description, created_at, updated_at
    FROM groups_social
    WHERE id = ?
    LIMIT 1
    `,
    [groupId]
  );
  if (!groupRows.length) return null;
  const group = groupRows[0];
  const [memberRows, inviteRows, activeChallenge, lastMessage] = await Promise.all([
    q(
      `
      SELECT wallet_address, member_role, created_at
      FROM group_members
      WHERE group_id = ?
      ORDER BY member_role DESC, created_at ASC
      `,
      [groupId]
    ),
    q(
      `
      SELECT id, inviter_wallet, invitee_wallet, status, created_at
      FROM group_invites
      WHERE group_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      `,
      [groupId]
    ),
    getActiveGroupChallenge(groupId),
    getLatestGroupMessage(groupId),
  ]);

  const members = await Promise.all(
    memberRows.map(async (row) => {
      const profile = await buildCommunityUserSummary(row.wallet_address);
      return {
        ...profile,
        memberRole: row.member_role,
        joinedAt: toIsoMaybe(row.created_at),
      };
    })
  );

  const pendingInvites = await Promise.all(
    inviteRows.map(async (row) => {
      const profile = await buildCommunityUserSummary(row.invitee_wallet);
      return {
        inviteId: Number(row.id),
        inviterWallet: row.inviter_wallet,
        createdAt: toIsoMaybe(row.created_at),
        status: row.status,
        ...profile,
      };
    })
  );

  const totalDistanceKm = members.reduce((sum, member) => sum + Number(member?.rewards?.breakdown?.distanceKm || 0), 0);
  const [scoreSnapshot, globalMilestone] = await Promise.all([
    getGroupScoreSnapshot(groupId, totalDistanceKm),
    ensureGlobalGroupMilestoneRewards(groupId, members, totalDistanceKm),
  ]);
  const activeChallengeProgressKm = activeChallenge
    ? await getGroupDistanceKm(groupId, { startsAt: activeChallenge.startsAt, endsAt: activeChallenge.endsAt })
    : 0;
  const viewerOwnsCrown = viewerWallet && globalMilestone?.rewardItemId
    ? await doesWalletOwnItem(viewerWallet, globalMilestone.rewardItemId)
    : false;

  return {
    id: Number(group.id),
    ownerWallet: group.owner_wallet,
    name: group.name,
    description: group.description || "",
    createdAt: toIsoMaybe(group.created_at),
    updatedAt: toIsoMaybe(group.updated_at),
    members,
    pendingInvites,
    lastMessage,
    score: scoreSnapshot,
    globalMilestone,
    viewerRewardState: viewerWallet
      ? {
          crownClaimed: viewerOwnsCrown,
          canClaimCrown: globalMilestone.unlocked,
        }
      : null,
    permissions: viewerWallet
      ? (() => {
          const role = members.find((member) => normalizeWalletAddress(member.walletAddress) === normalizeWalletAddress(viewerWallet))?.memberRole || null;
          return {
            role,
            canManageChallenge: canManageGroupChallenge(role),
            canInviteMembers: role === "owner",
            canManageAdmins: role === "owner",
            canDeleteGroup: role === "owner",
          };
        })()
      : null,
    activeChallenge: activeChallenge
      ? {
          ...activeChallenge,
          progressKm: activeChallengeProgressKm,
          remainingKm: Math.max(0, Number(activeChallenge.targetKm || 0) - activeChallengeProgressKm),
          completed: activeChallengeProgressKm >= Number(activeChallenge.targetKm || 0),
          bonusPoints: computeChallengeBonusPoints(activeChallenge.targetKm, activeChallenge.startsAt, activeChallenge.endsAt),
        }
      : null,
  };
}

async function buildGroupsForWallet(wallet) {
  const rows = await getGroupRowsForWallet(wallet);
  const groups = await Promise.all(
    rows.map(async (row) => {
      const [detail, unreadCount] = await Promise.all([
        buildGroupDetails(row.id, wallet),
        getUnreadGroupCount(row.id, wallet),
      ]);
      return detail
        ? {
            ...detail,
            viewerRole: row.member_role,
            unreadCount,
          }
        : null;
    })
  );
  return groups.filter(Boolean);
}

async function buildGroupLeaderboard() {
  const rows = await q(
    `
    SELECT id
    FROM groups_social
    ORDER BY updated_at DESC, created_at DESC
    `
  );
  const groups = (await Promise.all(rows.map((row) => buildGroupDetails(row.id)))).filter(Boolean);
  return groups
    .sort((a, b) => {
      const scoreDiff = Number(b?.score?.score || 0) - Number(a?.score?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const distanceDiff = Number(b?.score?.totalDistanceKm || 0) - Number(a?.score?.totalDistanceKm || 0);
      if (distanceDiff !== 0) return distanceDiff;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    })
    .map((group, index) => ({
      rank: index + 1,
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group.members.length,
      score: group.score,
      globalMilestone: group.globalMilestone,
      topMembers: [...group.members]
        .sort((a, b) => Number(b?.rewards?.breakdown?.distanceKm || 0) - Number(a?.rewards?.breakdown?.distanceKm || 0))
        .slice(0, 3),
    }));
}

async function inviteToGroup(groupId, inviterWallet, inviteeWallet) {
  const inviter = normalizeWalletAddress(inviterWallet);
  const invitee = await resolveWalletOrDisplayName(inviteeWallet);
  if (inviter === invitee) throw new Error("You cannot invite yourself");

  const groupRows = await q(`SELECT id FROM groups_social WHERE id = ? LIMIT 1`, [groupId]);
  if (!groupRows.length) throw new Error("Group not found");
  const inviterRole = await getGroupMemberRole(groupId, inviter);
  if (inviterRole !== "owner") {
    throw new Error("Only the group owner can invite members");
  }

  const memberRows = await q(
    `
    SELECT id
    FROM group_members
    WHERE group_id = ? AND wallet_address = ?
    LIMIT 1
    `,
    [groupId, invitee]
  );
  if (memberRows.length) throw new Error("This wallet is already a group member");

  await db.query(
    `
    INSERT INTO group_invites (group_id, inviter_wallet, invitee_wallet, status, responded_at, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', NULL, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      inviter_wallet = VALUES(inviter_wallet),
      status = 'pending',
      responded_at = NULL,
      updated_at = NOW()
    `,
    [groupId, inviter, invitee]
  );

  const groupInfo = await q(`SELECT name FROM groups_social WHERE id = ? LIMIT 1`, [groupId]);
  const groupName = groupInfo[0]?.name || `Group #${groupId}`;
  await notify(invitee, {
    type: "group_invite",
    title: "Group invitation",
    body: `You were invited to join "${groupName}".`,
    refType: "group",
    refId: groupId,
  });
}

async function getPendingGroupInvites(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT gi.id, gi.group_id, gi.inviter_wallet, gi.created_at, g.name, g.description, g.owner_wallet
    FROM group_invites gi
    JOIN groups_social g ON g.id = gi.group_id
    WHERE gi.invitee_wallet = ? AND gi.status = 'pending'
    ORDER BY gi.created_at DESC
    `,
    [normalizedWallet]
  );

  return Promise.all(
    rows.map(async (row) => {
      const inviterProfile = await buildCommunityUserSummary(row.inviter_wallet);
      return {
        inviteId: Number(row.id),
        groupId: Number(row.group_id),
        groupName: row.name,
        groupDescription: row.description || "",
        ownerWallet: row.owner_wallet,
        createdAt: toIsoMaybe(row.created_at),
        inviter: inviterProfile,
      };
    })
  );
}

async function acceptGroupInvite(wallet, groupId, inviteId) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id, invitee_wallet, status
    FROM group_invites
    WHERE id = ? AND group_id = ?
    LIMIT 1
    `,
    [inviteId, groupId]
  );
  if (!rows.length) throw new Error("Group invite not found");
  const row = rows[0];
  if (normalizeWalletAddress(row.invitee_wallet) !== normalizedWallet) {
    throw new Error("Only the invited wallet can accept this group invite");
  }
  if (row.status !== "pending") throw new Error("Group invite is no longer pending");

  await db.query(
    `
    UPDATE group_invites
    SET status = 'accepted',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
    `,
    [inviteId]
  );
  await db.query(
    `
    INSERT INTO group_members (group_id, wallet_address, member_role, created_at)
    VALUES (?, ?, 'member', NOW())
    ON DUPLICATE KEY UPDATE wallet_address = VALUES(wallet_address)
    `,
    [groupId, normalizedWallet]
  );
}

async function declineGroupInvite(wallet, groupId, inviteId) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id, invitee_wallet, status
    FROM group_invites
    WHERE id = ? AND group_id = ?
    LIMIT 1
    `,
    [inviteId, groupId]
  );
  if (!rows.length) throw new Error("Group invite not found");
  const row = rows[0];
  if (normalizeWalletAddress(row.invitee_wallet) !== normalizedWallet) {
    throw new Error("Only the invited wallet can decline this group invite");
  }
  if (row.status !== "pending") throw new Error("Group invite is no longer pending");

  await db.query(
    `
    UPDATE group_invites
    SET status = 'declined',
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = ?
    `,
    [inviteId]
  );
}

async function buildSocialSummary(wallet) {
  const [friendData, groups, pendingGroupInvites] = await Promise.all([
    getFriendSocialData(wallet),
    buildGroupsForWallet(wallet),
    getPendingGroupInvites(wallet),
  ]);
  return {
    ...friendData,
    groups,
    pendingGroupInvites,
  };
}

async function buildPublicFriendPreview(wallet) {
  const friends = await buildFriendProfiles(wallet);
  return friends.map((friend) => ({
    walletAddress: friend.walletAddress,
    displayName: friend.displayName,
    customDisplayName: friend.customDisplayName,
    avatar: friend.avatar,
  }));
}

async function buildPublicGroupPreview(wallet) {
  const groups = await buildGroupsForWallet(wallet);
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: group.members.length,
  }));
}

async function isGroupMember(groupId, wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT id
    FROM group_members
    WHERE group_id = ? AND wallet_address = ?
    LIMIT 1
    `,
    [groupId, normalizedWallet]
  );
  return rows.length > 0;
}

async function getGroupMemberRole(groupId, wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const rows = await q(
    `
    SELECT member_role
    FROM group_members
    WHERE group_id = ? AND wallet_address = ?
    LIMIT 1
    `,
    [groupId, normalizedWallet]
  );
  return rows[0]?.member_role || null;
}

function canManageGroupChallenge(role) {
  return role === "owner" || role === "admin";
}

function canKickTarget(actorRole, targetRole) {
  if (actorRole === "owner") return targetRole !== "owner";
  if (actorRole === "admin") return targetRole === "member";
  return false;
}

async function updateGroupMemberRole(groupId, actorWallet, targetWallet, nextRole) {
  const actor = normalizeWalletAddress(actorWallet);
  const target = normalizeWalletAddress(targetWallet);
  if (actor === target) throw new Error("Owner cannot change their own role");
  const actorRole = await getGroupMemberRole(groupId, actor);
  const targetRole = await getGroupMemberRole(groupId, target);
  if (actorRole !== "owner") throw new Error("Only the owner can manage admin roles");
  if (!targetRole || targetRole === "owner") throw new Error("Target member cannot be updated");
  await db.query(
    `
    UPDATE group_members
    SET member_role = ?
    WHERE group_id = ? AND wallet_address = ?
    `,
    [nextRole, groupId, target]
  );
}

async function removeGroupMember(groupId, actorWallet, targetWallet) {
  const actor = normalizeWalletAddress(actorWallet);
  const target = normalizeWalletAddress(targetWallet);
  const actorRole = await getGroupMemberRole(groupId, actor);
  const targetRole = await getGroupMemberRole(groupId, target);
  if (!actorRole || !targetRole) throw new Error("Group member not found");
  if (!canKickTarget(actorRole, targetRole)) {
    throw new Error("You do not have permission to remove this member");
  }
  await db.query(`DELETE FROM group_members WHERE group_id = ? AND wallet_address = ?`, [groupId, target]);
}

async function leaveGroup(groupId, walletAddress) {
  const wallet = normalizeWalletAddress(walletAddress);
  const role = await getGroupMemberRole(groupId, wallet);
  if (!role) throw new Error("Group member not found");
  if (role === "owner") {
    throw new Error("Owner cannot leave the group. Delete it instead.");
  }
  await db.query(`DELETE FROM group_members WHERE group_id = ? AND wallet_address = ?`, [groupId, wallet]);
}

async function deleteGroup(groupId, actorWallet) {
  const actor = normalizeWalletAddress(actorWallet);
  const role = await getGroupMemberRole(groupId, actor);
  if (role !== "owner") throw new Error("Only the owner can delete the group");
  await db.query(`DELETE FROM group_messages WHERE group_id = ?`, [groupId]);
  await db.query(`DELETE FROM group_invites WHERE group_id = ?`, [groupId]);
  await db.query(`DELETE FROM group_members WHERE group_id = ?`, [groupId]);
  await db.query(`DELETE FROM group_challenges WHERE group_id = ?`, [groupId]);
  await db.query(`DELETE FROM group_reward_grants WHERE group_id = ?`, [groupId]);
  await db.query(`DELETE FROM groups_social WHERE id = ?`, [groupId]);
}

async function hasGroupRewardGrant(groupId, walletAddress, rewardCode) {
  const rows = await q(
    `
    SELECT 1 AS ok
    FROM group_reward_grants
    WHERE group_id = ? AND wallet_address = ? AND reward_code = ?
    LIMIT 1
    `,
    [groupId, normalizeWalletAddress(walletAddress), rewardCode]
  );
  return rows.length > 0;
}

async function claimGroupCrownReward(groupId, walletAddress, txHash, chainId) {
  const wallet = normalizeWalletAddress(walletAddress);
  const role = await getGroupMemberRole(groupId, wallet);
  if (!role) throw new Error("Only current group members can claim this reward");
  if (Number(chainId) !== GCT_CONFIG.chainId) {
    throw new Error(`Invalid chainId for crown claim. Expected ${GCT_CONFIG.chainId}`);
  }
  const group = await buildGroupDetails(groupId);
  if (!group?.globalMilestone?.unlocked) {
    throw new Error("Global crown milestone is not unlocked yet");
  }
  const rewardItem = getGroupCrownRewardItem();
  if (!rewardItem?.id) {
    throw new Error("Reward crown item was not found in items.json");
  }
  const validation = await validateZeroValueOnChainActionTx(txHash, wallet, GCT_CONFIG.burnAddress);
  const alreadyClaimed = await doesWalletOwnItem(wallet, rewardItem.id);
  await grantGroupRewardIfMissing(groupId, wallet, GROUP_CROWN_REWARD_CODE, rewardItem, {
    purchaseMode: "onchain",
    txHash: validation.txHash,
    chainId: validation.chainId,
  });
  return { alreadyClaimed, rewardItem, repaired: true, txHash: validation.txHash, chainId: validation.chainId };
}

async function getDirectMessages(wallet, otherWallet) {
  const a = normalizeWalletAddress(wallet);
  const b = normalizeWalletAddress(otherWallet);
  if (!(await areFriends(a, b))) {
    throw new Error("Direct messages are only available between friends");
  }

  const rows = await q(
    `
    SELECT id, sender_wallet, recipient_wallet, message_text, created_at
    FROM direct_messages
    WHERE (sender_wallet = ? AND recipient_wallet = ?)
       OR (sender_wallet = ? AND recipient_wallet = ?)
    ORDER BY created_at ASC
    LIMIT 100
    `,
    [a, b, b, a]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    senderWallet: row.sender_wallet,
    recipientWallet: row.recipient_wallet,
    message: row.message_text,
    createdAt: toIsoMaybe(row.created_at),
  }));
}

async function getLatestDirectMessageBetween(wallet, otherWallet) {
  const a = normalizeWalletAddress(wallet);
  const b = normalizeWalletAddress(otherWallet);
  const rows = await q(
    `
    SELECT id, sender_wallet, recipient_wallet, message_text, created_at
    FROM direct_messages
    WHERE (sender_wallet = ? AND recipient_wallet = ?)
       OR (sender_wallet = ? AND recipient_wallet = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [a, b, b, a]
  );

  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: Number(row.id),
    senderWallet: row.sender_wallet,
    recipientWallet: row.recipient_wallet,
    message: row.message_text,
    createdAt: toIsoMaybe(row.created_at),
  };
}

async function getUnreadDirectCount(readerWallet, otherWallet) {
  const reader = normalizeWalletAddress(readerWallet);
  const other = normalizeWalletAddress(otherWallet);
  const readRows = await q(
    `
    SELECT last_read_message_id
    FROM direct_message_reads
    WHERE reader_wallet = ? AND other_wallet = ?
    LIMIT 1
    `,
    [reader, other]
  );
  const lastReadId = Number(readRows[0]?.last_read_message_id || 0);
  const countRows = await q(
    `
    SELECT COUNT(*) AS c
    FROM direct_messages
    WHERE sender_wallet = ? AND recipient_wallet = ? AND id > ?
    `,
    [other, reader, lastReadId]
  );
  return Number(countRows[0]?.c || 0);
}

async function markDirectThreadRead(readerWallet, otherWallet) {
  const reader = normalizeWalletAddress(readerWallet);
  const other = normalizeWalletAddress(otherWallet);
  const maxRows = await q(
    `
    SELECT MAX(id) AS last_id
    FROM direct_messages
    WHERE sender_wallet = ? AND recipient_wallet = ?
    `,
    [other, reader]
  );
  const lastId = Number(maxRows[0]?.last_id || 0);
  await db.query(
    `
    INSERT INTO direct_message_reads (reader_wallet, other_wallet, last_read_message_id, updated_at)
    VALUES (?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      last_read_message_id = VALUES(last_read_message_id),
      updated_at = NOW()
    `,
    [reader, other, lastId]
  );
}

async function getLatestGroupMessage(groupId) {
  const rows = await q(
    `
    SELECT id, sender_wallet, message_text, created_at
    FROM group_messages
    WHERE group_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [groupId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    senderWallet: row.sender_wallet,
    message: row.message_text,
    createdAt: toIsoMaybe(row.created_at),
  };
}

async function getUnreadGroupCount(groupId, readerWallet) {
  const reader = normalizeWalletAddress(readerWallet);
  const readRows = await q(
    `
    SELECT last_read_message_id
    FROM group_message_reads
    WHERE group_id = ? AND reader_wallet = ?
    LIMIT 1
    `,
    [groupId, reader]
  );
  const lastReadId = Number(readRows[0]?.last_read_message_id || 0);
  const countRows = await q(
    `
    SELECT COUNT(*) AS c
    FROM group_messages
    WHERE group_id = ? AND sender_wallet <> ? AND id > ?
    `,
    [groupId, reader, lastReadId]
  );
  return Number(countRows[0]?.c || 0);
}

async function markGroupThreadRead(groupId, readerWallet) {
  const reader = normalizeWalletAddress(readerWallet);
  const maxRows = await q(
    `
    SELECT MAX(id) AS last_id
    FROM group_messages
    WHERE group_id = ? AND sender_wallet <> ?
    `,
    [groupId, reader]
  );
  const lastId = Number(maxRows[0]?.last_id || 0);
  await db.query(
    `
    INSERT INTO group_message_reads (group_id, reader_wallet, last_read_message_id, updated_at)
    VALUES (?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      last_read_message_id = VALUES(last_read_message_id),
      updated_at = NOW()
    `,
    [groupId, reader, lastId]
  );
}

let avatarItemManifestCache = {
  loadedAt: 0,
  items: [],
};

function loadAvatarItemManifest() {
  const now = Date.now();
  if (now - avatarItemManifestCache.loadedAt < 5000 && avatarItemManifestCache.items.length) {
    return avatarItemManifestCache.items;
  }
  try {
    const filePath = path.join(__dirname, "..", "green-dapp", "public", "items", "items.json");
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    avatarItemManifestCache = {
      loadedAt: now,
      items: Array.isArray(json) ? json : [],
    };
    return avatarItemManifestCache.items;
  } catch {
    return [];
  }
}

function getGroupCrownRewardItem() {
  const items = loadAvatarItemManifest();
  return (
    items.find((item) => {
      const haystack = [
        String(item?.id || ""),
        String(item?.name || ""),
        ...(Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag)) : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes("crown") || haystack.includes("korona");
    }) || null
  );
}

function toSqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid datetime value");
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function getChallengeDurationWeight(startsAt, endsAt) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  const days = Math.max(1, (end - start) / 86400000);
  if (days <= 7) return 1.0;
  if (days <= 14) return 0.9;
  if (days <= 30) return 0.75;
  return 0.6;
}

function computeChallengeBonusPoints(targetKm, startsAt, endsAt) {
  const target = Number(targetKm || 0);
  if (target < GROUP_CHALLENGE_MIN_KM) return 0;
  const bonus = target * getChallengeDurationWeight(startsAt, endsAt) * GROUP_CHALLENGE_SCORE_FACTOR;
  return Number(Math.min(GROUP_CHALLENGE_SCORE_CAP, bonus).toFixed(2));
}

async function getGroupDistanceKm(groupId, options = {}) {
  const params = [groupId];
  let sql = `
    SELECT SUM(e.distance_km) AS total_km
    FROM group_members gm
    JOIN events e ON e.wallet_address = gm.wallet_address
    WHERE gm.group_id = ?
  `;
  if (options.startsAt) {
    sql += ` AND e.event_time >= ?`;
    params.push(toSqlDateTime(options.startsAt));
  }
  if (options.endsAt) {
    sql += ` AND e.event_time <= ?`;
    params.push(toSqlDateTime(options.endsAt));
  }
  const rows = await q(sql, params);
  return Number(rows[0]?.total_km || 0);
}

async function reconcileGroupChallenges(groupId) {
  const rows = await q(
    `
    SELECT id, target_km, starts_at, ends_at, is_active, completed_at
    FROM group_challenges
    WHERE group_id = ? AND is_active = 1
    ORDER BY updated_at DESC, id DESC
    `,
    [groupId]
  );
  const now = Date.now();
  for (const row of rows) {
    const startsAt = toIsoMaybe(row.starts_at);
    const endsAt = toIsoMaybe(row.ends_at);
    const progressKm = await getGroupDistanceKm(groupId, { startsAt, endsAt });
    if (progressKm >= Number(row.target_km || 0)) {
      await db.query(
        `
        UPDATE group_challenges
        SET is_active = 0,
            completed_at = COALESCE(completed_at, NOW()),
            bonus_points = COALESCE(bonus_points, ?),
            updated_at = NOW()
        WHERE id = ?
        `,
        [computeChallengeBonusPoints(row.target_km, startsAt, endsAt), row.id]
      );
      continue;
    }
    if (endsAt && new Date(endsAt).getTime() < now) {
      await db.query(
        `
        UPDATE group_challenges
        SET is_active = 0,
            updated_at = NOW()
        WHERE id = ?
        `,
        [row.id]
      );
    }
  }
}

async function getCompletedGroupChallengeStats(groupId) {
  const rows = await q(
    `
    SELECT id, title, target_km, starts_at, ends_at, completed_at, bonus_points
    FROM group_challenges
    WHERE group_id = ? AND completed_at IS NOT NULL
    ORDER BY completed_at DESC, id DESC
    `,
    [groupId]
  );
  const completedChallenges = rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    targetKm: Number(row.target_km || 0),
    startsAt: toIsoMaybe(row.starts_at),
    endsAt: toIsoMaybe(row.ends_at),
    completedAt: toIsoMaybe(row.completed_at),
    bonusPoints: Number(row.bonus_points || computeChallengeBonusPoints(row.target_km, row.starts_at, row.ends_at)),
  }));
  const challengeScore = completedChallenges.reduce((sum, row) => sum + Number(row.bonusPoints || 0), 0);
  return {
    completedChallenges,
    completedCount: completedChallenges.length,
    challengeScore: Number(challengeScore.toFixed(2)),
  };
}

async function grantGroupRewardIfMissing(groupId, walletAddress, rewardCode, rewardItem, options = {}) {
  const wallet = normalizeWalletAddress(walletAddress);
  const purchaseMode = String(options.purchaseMode || "group_reward");
  const txHash = options.txHash ? String(options.txHash).trim() : null;
  const chainId = options.chainId == null ? null : Number(options.chainId);
  const nftGrant = rewardItem?.id ? await ensureWalletOwnsCosmeticItemOnChain(wallet, rewardItem.id) : null;
  const metadata = JSON.stringify({
    rewardCode,
    groupId,
    rewardType: "group-milestone",
    cosmeticTokenId: nftGrant?.tokenId ?? null,
    cosmeticMintTxHash: nftGrant?.txHash ?? null,
    cosmeticMetadataUri: nftGrant?.metadataUri ?? null,
  });
  await db.query(
    `
    INSERT IGNORE INTO group_reward_grants (group_id, wallet_address, reward_code, reward_item_id, granted_at, metadata_json)
    VALUES (?, ?, ?, ?, NOW(), ?)
    `,
    [groupId, wallet, rewardCode, rewardItem?.id || null, metadata]
  );
	  if (!rewardItem?.id) return;
  const existingRows = await q(
    `
    SELECT id, purchase_mode
    FROM shop_purchases
    WHERE wallet_address = ? AND item_id = ?
    LIMIT 1
    `,
    [wallet, rewardItem.id]
  );
	  if (existingRows.length) {
	    const existingId = Number(existingRows[0].id);
	    if (purchaseMode === "onchain" || nftGrant?.txHash) {
	      await db.query(
	        `
	        UPDATE shop_purchases
	        SET purchase_mode = 'onchain',
	            tx_hash = ?,
	            chain_id = ?,
	            metadata_json = ?
	        WHERE id = ?
	        `,
	        [txHash, chainId, metadata, existingId]
	      );
	    }
	    return;
	  }
  await db.query(
    `
    INSERT INTO shop_purchases
      (wallet_address, item_id, item_name, slot_name, price_tokens, purchase_mode, tx_hash, chain_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, NOW())
    `,
    [wallet, rewardItem.id, rewardItem.name || rewardItem.id, rewardItem.slot || "reward", purchaseMode, txHash, chainId, metadata]
  );
}

async function ensureGlobalGroupMilestoneRewards(groupId, members, totalDistanceKm) {
  const targetKm = GROUP_CROWN_TARGET_KM;
  const unlocked = Number(totalDistanceKm || 0) >= targetKm;
  const rewardItem = getGroupCrownRewardItem();
  const grantRows = await q(
    `
    SELECT COUNT(*) AS c
    FROM group_reward_grants
    WHERE group_id = ? AND reward_code = ?
    `,
    [groupId, GROUP_CROWN_REWARD_CODE]
  );
  return {
    code: GROUP_CROWN_REWARD_CODE,
    title: "Group Crown Milestone",
    rewardItemId: rewardItem?.id || null,
    rewardItemName: rewardItem?.name || "Reward Crown",
    targetKm,
    progressKm: Number(totalDistanceKm || 0),
    unlocked,
    grantedCount: Number(grantRows[0]?.c || 0),
  };
}

async function getGroupScoreSnapshot(groupId, totalDistanceKm) {
  const completed = await getCompletedGroupChallengeStats(groupId);
  return {
    totalDistanceKm: Number(totalDistanceKm || 0),
    completedChallenges: completed.completedCount,
    challengeScore: completed.challengeScore,
    score: Number((Number(totalDistanceKm || 0) + completed.challengeScore).toFixed(2)),
    challengeHistory: completed.completedChallenges,
  };
}

async function getActiveGroupChallenge(groupId) {
  await reconcileGroupChallenges(groupId);
  const rows = await q(
    `
    SELECT id, group_id, title, target_km, created_by_wallet, starts_at, ends_at, created_at, updated_at
    FROM group_challenges
    WHERE group_id = ? AND is_active = 1
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [groupId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    title: row.title,
    targetKm: Number(row.target_km || 0),
    createdByWallet: row.created_by_wallet,
    startsAt: toIsoMaybe(row.starts_at),
    endsAt: toIsoMaybe(row.ends_at),
    createdAt: toIsoMaybe(row.created_at),
    updatedAt: toIsoMaybe(row.updated_at),
  };
}

async function buildDirectInbox(wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const friends = await buildFriendProfiles(normalizedWallet);

  const inbox = await Promise.all(
    friends.map(async (friend) => {
      const [lastMessage, unreadCount] = await Promise.all([
        getLatestDirectMessageBetween(normalizedWallet, friend.walletAddress),
        getUnreadDirectCount(normalizedWallet, friend.walletAddress),
      ]);
      return {
        walletAddress: friend.walletAddress,
        displayName: friend.displayName,
        customDisplayName: friend.customDisplayName,
        avatar: friend.avatar,
        rewards: friend.rewards,
        presence: friend.presence,
        lastMessage,
        unreadCount,
      };
    })
  );

  inbox.sort((a, b) => {
    const aTime = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return communityDisplaySortValue(a).localeCompare(communityDisplaySortValue(b));
  });

  return inbox;
}

async function sendDirectMessage(senderWallet, otherWallet, messageText) {
  const sender = normalizeWalletAddress(senderWallet);
  const recipient = normalizeWalletAddress(otherWallet);
  const message = sanitizeMessageText(messageText);
  if (!(await areFriends(sender, recipient))) {
    throw new Error("You can only message accepted friends");
  }
  await db.query(
    `
    INSERT INTO direct_messages (sender_wallet, recipient_wallet, message_text, created_at)
    VALUES (?, ?, ?, NOW())
    `,
    [sender, recipient, message]
  );
  return getDirectMessages(sender, recipient);
}

async function getGroupMessages(groupId, wallet) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!(await isGroupMember(groupId, normalizedWallet))) {
    throw new Error("Only group members can view group messages");
  }

  const rows = await q(
    `
    SELECT id, sender_wallet, message_text, created_at
    FROM group_messages
    WHERE group_id = ?
    ORDER BY created_at ASC
    LIMIT 150
    `,
    [groupId]
  );

  return Promise.all(
    rows.map(async (row) => {
      const profile = await buildCommunityUserSummary(row.sender_wallet);
      return {
        id: Number(row.id),
        senderWallet: row.sender_wallet,
        senderDisplayName: profile.customDisplayName || row.sender_wallet,
        message: row.message_text,
        createdAt: toIsoMaybe(row.created_at),
      };
    })
  );
}

async function sendGroupMessage(groupId, wallet, messageText) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const message = sanitizeMessageText(messageText);
  if (!(await isGroupMember(groupId, normalizedWallet))) {
    throw new Error("Only group members can send group messages");
  }
  await db.query(
    `
    INSERT INTO group_messages (group_id, sender_wallet, message_text, created_at)
    VALUES (?, ?, ?, NOW())
    `,
    [groupId, normalizedWallet, message]
  );
  await db.query(
    `
    UPDATE groups_social
    SET updated_at = NOW()
    WHERE id = ?
    `,
    [groupId]
  );
  return getGroupMessages(groupId, normalizedWallet);
}

async function buildPublicProfile(wallet, viewerWallet = "") {
  const normalizedWallet = normalizeWalletAddress(wallet);
  const [summary, friends, groups, likeSnapshot] = await Promise.all([
    buildCommunityUserSummary(normalizedWallet),
    buildPublicFriendPreview(normalizedWallet),
    buildPublicGroupPreview(normalizedWallet),
    getLikeSnapshot(normalizedWallet, viewerWallet),
  ]);

  return {
    ...summary,
    friends,
    groups,
    likes: likeSnapshot,
  };
}

// ----------------------------------------------------
// DUMMY GENERATOR
// ----------------------------------------------------
function makeDummyEvent() {
  return {
    walletAddress: pick(dummyWallets),
    tripType: pick(dummyTripTypes),
    distanceKm: Number(rand(1, 18).toFixed(2)),
    routeId: "R-" + Math.floor(rand(1, 30)),
    stopId: "S-" + Math.floor(rand(1, 200)),
    source: "dummy-ui",
    ts: Date.now(),
  };
}

function stopDummy() {
  dummyState.running = false;
  if (dummyState.timer) clearTimeout(dummyState.timer);
  dummyState.timer = null;
}

function scheduleNextDummySend() {
  if (!dummyState.running) return;

  const delay = Math.floor(rand(dummyState.minMs, dummyState.maxMs));
  dummyState.timer = setTimeout(async () => {
    try {
      const body = makeDummyEvent();
      await insertEventToDb(body);
      dummyState.sent++;
    } catch (e) {
      console.error("Dummy insert error:", e?.message || e);
    } finally {
      scheduleNextDummySend();
    }
  }, delay);
}

// ----------------------------------------------------
// ROUTES: BASIC / DEBUG
// ----------------------------------------------------
app.get("/", (_req, res) => {
  res.send("green-api is running. Try /health, /api/events, /api/stats/summary, /api/dummy/status");
});

app.get("/health", async (_req, res) => {
  try {
    const ok = await pingDb();
    res.json({
      ok: true,
      db: ok ? "connected" : "unknown",
      time: nowIso(),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: "error",
      error: e?.message || String(e),
    });
  }
});

app.get("/api/debug/db", async (_req, res) => {
  try {
    const rows = await q("SELECT DATABASE() AS dbName, NOW() AS nowTime");
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get("/api/debug/layouts", async (_req, res) => {
  try {
    const rows = await q(
      `
      SELECT wallet_address, saved_by_source, updated_at, created_at
      FROM avatar_layouts
      ORDER BY updated_at DESC
      LIMIT 50
      `
    );
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    console.error("GET /api/debug/layouts error:", e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ----------------------------------------------------
// ROUTES: EVENTS INGEST + READ
// ----------------------------------------------------
app.post("/api/events", async (req, res) => {
  try {
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const payload = {
      ...parsed.data,
      source: parsed.data.source ?? "external",
    };

    await touchUserPresence(payload.walletAddress, "event-ingest");
    const inserted = await insertEventToDb(payload);
    res.json({ ok: true, eventId: inserted.eventId });
  } catch (e) {
    console.error("POST /api/events error:", e);
    res.status(500).json({
      error: "Failed to save event",
      details: e?.message || String(e),
    });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const events = await getRecentEvents(limit);
    res.json({ count: events.length, events });
  } catch (e) {
    console.error("GET /api/events error:", e);
    res.status(500).json({
      error: "Failed to fetch events",
      details: e?.message || String(e),
    });
  }
});

// ----------------------------------------------------
// ROUTES: STATS
// ----------------------------------------------------
app.get("/api/stats/summary", async (_req, res) => {
  try {
    const wallet = statsWalletFilterFromReq(_req);
    const events = await getAllEventsForStats({ wallet });

    const byType = { bus: 0, rail: 0, monorail: 0, "park&ride": 0 };
    let totalTrips = 0;
    let totalDistance = 0;

    for (const e of events) {
      totalTrips++;
      byType[e.tripType] = (byType[e.tripType] || 0) + 1;
      if (typeof e.distanceKm === "number") totalDistance += e.distanceKm;
    }

    res.json({
      totalTrips,
      totalDistanceKm: Number(totalDistance.toFixed(2)),
      tripsByType: byType,
    });
  } catch (e) {
    console.error("GET /api/stats/summary error:", e);
    res.status(500).json({ error: "Failed to build summary", details: e?.message || String(e) });
  }
});

app.get("/api/stats/co2", async (_req, res) => {
  try {
    const wallet = statsWalletFilterFromReq(_req);
    const events = await getAllEventsForStats({ wallet });

    let saved_g = 0;
    for (const e of events) {
      if (typeof e.distanceKm !== "number") continue;

      const car = FACTORS.baseline_car;
      const mode =
        e.tripType === "bus"
          ? FACTORS.bus
          : e.tripType === "rail"
          ? FACTORS.rail
          : e.tripType === "monorail"
          ? FACTORS.monorail
          : FACTORS.park_ride;

      const diff = Math.max(0, car - mode);
      saved_g += e.distanceKm * diff;
    }

    const saved_kg = saved_g / 1000.0;

    res.json({
      assumptions: {
        unit: "gCO2e per passenger-km",
        factors: FACTORS,
        note: "Estimates for demo purposes. Replace factors with official sources if needed.",
      },
      savedCO2_kg: Number(saved_kg.toFixed(3)),
      savedCO2_tons: Number((saved_kg / 1000).toFixed(6)),
    });
  } catch (e) {
    console.error("GET /api/stats/co2 error:", e);
    res.status(500).json({ error: "Failed to build co2 stats", details: e?.message || String(e) });
  }
});

app.get("/api/stats/leaderboard", async (_req, res) => {
  try {
    const wallet = statsWalletFilterFromReq(_req);
    const events = await getAllEventsForStats({ wallet });

    const map = new Map();
    for (const e of events) {
      const cur = map.get(e.walletAddress) || {
        walletAddress: e.walletAddress,
        trips: 0,
        distanceKm: 0,
      };
      cur.trips++;
      if (typeof e.distanceKm === "number") cur.distanceKm += e.distanceKm;
      map.set(e.walletAddress, cur);
    }

    const topBase = [...map.values()]
      .sort((a, b) => b.distanceKm - a.distanceKm)
      .slice(0, 10)
      .map((x) => ({ ...x, distanceKm: Number(x.distanceKm.toFixed(2)) }));

    const top = await Promise.all(
      topBase.map(async (entry) => {
        const [avatar, userProfile] = await Promise.all([
          getAvatarLayoutByWallet(entry.walletAddress),
          getUserProfileByWallet(entry.walletAddress),
        ]);
        return {
          ...entry,
          displayName: userProfile?.displayName || entry.walletAddress,
          customDisplayName: userProfile?.displayName || null,
          avatar: avatar
            ? {
                exists: true,
                layout: avatar.layout,
                updatedAt: avatar.updatedAt,
              }
            : {
                exists: false,
                layout: null,
              },
        };
      })
    );

    res.json({ top });
  } catch (e) {
    console.error("GET /api/stats/leaderboard error:", e);
    res.status(500).json({ error: "Failed to build leaderboard", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/profile", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    await touchUserPresence(wallet, "profile-view");
    const profile = await getUserProfileByWallet(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      displayName: profile?.displayName || null,
      profile,
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/profile error:", e);
    res.status(500).json({ error: "Failed to load user profile", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/profile", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const parsed = UserProfileSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await touchUserPresence(wallet, "profile-save");
    const profile = await upsertUserProfile(wallet, parsed.data.displayName);
    res.json({
      ok: true,
      walletAddress: wallet,
      displayName: profile?.displayName || null,
      profile,
    });
  } catch (e) {
    console.error("POST /api/users/:wallet/profile error:", e);
    res.status(500).json({ error: "Failed to save user profile", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/social", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    await touchUserPresence(wallet, "social-view");
    const social = await buildSocialSummary(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      ...social,
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/social error:", e);
    res.status(500).json({ error: "Failed to load social data", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/friends", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const { friends } = await getFriendSocialData(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      count: friends.length,
      friends,
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/friends error:", e);
    res.status(500).json({ error: "Failed to load friends", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/friend-requests", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const { incomingRequests, outgoingRequests } = await getFriendSocialData(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      incomingRequests,
      outgoingRequests,
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/friend-requests error:", e);
    res.status(500).json({ error: "Failed to load friend requests", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/friend-requests", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const parsed = UserFriendSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const result = await sendFriendRequest(wallet, parsed.data.friendWallet);
    const social = await getFriendSocialData(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      autoAccepted: result.autoAccepted,
      ...social,
    });
  } catch (e) {
    console.error("POST /api/users/:wallet/friend-requests error:", e);
    res.status(500).json({ error: "Failed to send friend request", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/friend-requests/:id/accept", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const id = Number(req.params.id);
    if (!wallet || wallet.length < 6 || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    await acceptFriendRequest(wallet, id);
    const social = await getFriendSocialData(wallet);
    res.json({ ok: true, walletAddress: wallet, ...social });
  } catch (e) {
    console.error("POST /api/users/:wallet/friend-requests/:id/accept error:", e);
    res.status(500).json({ error: "Failed to accept friend request", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/friend-requests/:id/reject", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const id = Number(req.params.id);
    if (!wallet || wallet.length < 6 || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    await rejectFriendRequest(wallet, id);
    const social = await getFriendSocialData(wallet);
    res.json({ ok: true, walletAddress: wallet, ...social });
  } catch (e) {
    console.error("POST /api/users/:wallet/friend-requests/:id/reject error:", e);
    res.status(500).json({ error: "Failed to reject friend request", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/friend-requests/:id/cancel", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const id = Number(req.params.id);
    if (!wallet || wallet.length < 6 || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    await cancelFriendRequest(wallet, id);
    const social = await getFriendSocialData(wallet);
    res.json({ ok: true, walletAddress: wallet, ...social });
  } catch (e) {
    console.error("POST /api/users/:wallet/friend-requests/:id/cancel error:", e);
    res.status(500).json({ error: "Failed to cancel friend request", details: e?.message || String(e) });
  }
});

app.delete("/api/users/:wallet/friends/:friendWallet", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const friendWallet = normalizeWalletAddress(req.params.friendWallet);
    if (!wallet || wallet.length < 6 || !friendWallet || friendWallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    await removeFriendship(wallet, friendWallet);
    const { friends } = await getFriendSocialData(wallet);
    res.json({
      ok: true,
      walletAddress: wallet,
      count: friends.length,
      friends,
    });
  } catch (e) {
    console.error("DELETE /api/users/:wallet/friends/:friendWallet error:", e);
    res.status(500).json({ error: "Failed to remove friend", details: e?.message || String(e) });
  }
});

app.post("/api/groups", async (req, res) => {
  try {
    const parsed = GroupCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const groupId = await createGroup(parsed.data.ownerWallet, parsed.data.name, parsed.data.description);
    const group = await buildGroupDetails(groupId);
    res.json({ ok: true, group });
  } catch (e) {
    console.error("POST /api/groups error:", e);
    res.status(500).json({ error: "Failed to create group", details: e?.message || String(e) });
  }
});

app.get("/api/groups/leaderboard", async (_req, res) => {
  try {
    const groups = await buildGroupLeaderboard();
    res.json({
      ok: true,
      groups,
    });
  } catch (e) {
    console.error("GET /api/groups/leaderboard error:", e);
    res.status(500).json({ error: "Failed to build group leaderboard", details: e?.message || String(e) });
  }
});

app.get("/api/groups/:groupId", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ error: "invalid group id" });
    }

    const group = await buildGroupDetails(groupId);
    if (!group) {
      return res.status(404).json({ error: "group not found" });
    }

    res.json({ ok: true, group });
  } catch (e) {
    console.error("GET /api/groups/:groupId error:", e);
    res.status(500).json({ error: "Failed to load group", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/invites", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ error: "invalid group id" });
    }

    const parsed = GroupInviteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await inviteToGroup(groupId, parsed.data.inviterWallet, parsed.data.inviteeWallet);
    const group = await buildGroupDetails(groupId);
    res.json({ ok: true, group });
  } catch (e) {
    console.error("POST /api/groups/:groupId/invites error:", e);
    res.status(500).json({ error: "Failed to invite to group", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/invites/:inviteId/accept", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const inviteId = Number(req.params.inviteId);
    if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(inviteId) || inviteId <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    const parsed = WalletActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await acceptGroupInvite(parsed.data.walletAddress, groupId, inviteId);
    const social = await buildSocialSummary(parsed.data.walletAddress);
    res.json({ ok: true, walletAddress: normalizeWalletAddress(parsed.data.walletAddress), ...social });
  } catch (e) {
    console.error("POST /api/groups/:groupId/invites/:inviteId/accept error:", e);
    res.status(500).json({ error: "Failed to accept group invite", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/invites/:inviteId/decline", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const inviteId = Number(req.params.inviteId);
    if (!Number.isFinite(groupId) || groupId <= 0 || !Number.isFinite(inviteId) || inviteId <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    const parsed = WalletActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    await declineGroupInvite(parsed.data.walletAddress, groupId, inviteId);
    const social = await buildSocialSummary(parsed.data.walletAddress);
    res.json({ ok: true, walletAddress: normalizeWalletAddress(parsed.data.walletAddress), ...social });
  } catch (e) {
    console.error("POST /api/groups/:groupId/invites/:inviteId/decline error:", e);
    res.status(500).json({ error: "Failed to decline group invite", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/direct-messages/:otherWallet", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const otherWallet = normalizeWalletAddress(req.params.otherWallet);
    if (!wallet || wallet.length < 6 || !otherWallet || otherWallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    await touchUserPresence(wallet, "direct-open");
    const messages = await getDirectMessages(wallet, otherWallet);
    res.json({ ok: true, walletAddress: wallet, otherWallet, messages });
  } catch (e) {
    console.error("GET /api/users/:wallet/direct-messages/:otherWallet error:", e);
    res.status(500).json({ error: "Failed to load direct messages", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/direct-inbox", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    await touchUserPresence(wallet, "chat-inbox");
    const conversations = await buildDirectInbox(wallet);
    const totalUnreadCount = conversations.reduce((sum, entry) => sum + Number(entry.unreadCount || 0), 0);
    res.json({ ok: true, walletAddress: wallet, conversations, totalUnreadCount });
  } catch (e) {
    console.error("GET /api/users/:wallet/direct-inbox error:", e);
    res.status(500).json({ error: "Failed to load direct inbox", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/direct-messages/:otherWallet", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const otherWallet = normalizeWalletAddress(req.params.otherWallet);
    if (!wallet || wallet.length < 6 || !otherWallet || otherWallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const senderWallet = normalizeWalletAddress(req.body?.senderWallet);
    if (senderWallet !== wallet) {
      return res.status(400).json({ error: "senderWallet must match route wallet" });
    }

    await touchUserPresence(wallet, "direct-send");
    const messages = await sendDirectMessage(wallet, otherWallet, req.body?.messageText);
    res.json({ ok: true, walletAddress: wallet, otherWallet, messages });
  } catch (e) {
    console.error("POST /api/users/:wallet/direct-messages/:otherWallet error:", e);
    res.status(500).json({ error: "Failed to send direct message", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/direct-messages/:otherWallet/read", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const otherWallet = normalizeWalletAddress(req.params.otherWallet);
    if (!wallet || wallet.length < 6 || !otherWallet || otherWallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }
    await markDirectThreadRead(wallet, otherWallet);
    const conversations = await buildDirectInbox(wallet);
    const totalUnreadCount = conversations.reduce((sum, entry) => sum + Number(entry.unreadCount || 0), 0);
    res.json({ ok: true, walletAddress: wallet, otherWallet, conversations, totalUnreadCount });
  } catch (e) {
    console.error("POST /api/users/:wallet/direct-messages/:otherWallet/read error:", e);
    res.status(500).json({ error: "Failed to mark direct thread as read", details: e?.message || String(e) });
  }
});

app.get("/api/groups/:groupId/messages", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const wallet = normalizeWalletAddress(req.query.wallet);
    if (!Number.isFinite(groupId) || groupId <= 0 || !wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid params" });
    }

    await touchUserPresence(wallet, "group-open");
    const messages = await getGroupMessages(groupId, wallet);
    res.json({ ok: true, groupId, walletAddress: wallet, messages });
  } catch (e) {
    console.error("GET /api/groups/:groupId/messages error:", e);
    res.status(500).json({ error: "Failed to load group messages", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/messages", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const wallet = normalizeWalletAddress(req.body?.walletAddress);
    if (!Number.isFinite(groupId) || groupId <= 0 || !wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid params" });
    }

    await touchUserPresence(wallet, "group-send");
    const messages = await sendGroupMessage(groupId, wallet, req.body?.messageText);
    res.json({ ok: true, groupId, walletAddress: wallet, messages });
  } catch (e) {
    console.error("POST /api/groups/:groupId/messages error:", e);
    res.status(500).json({ error: "Failed to send group message", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/messages/read", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = WalletActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    const wallet = normalizeWalletAddress(parsed.data.walletAddress);
    await markGroupThreadRead(groupId, wallet);
    const social = await buildSocialSummary(wallet);
    res.json({ ok: true, groupId, walletAddress: wallet, ...social });
  } catch (e) {
    console.error("POST /api/groups/:groupId/messages/read error:", e);
    res.status(500).json({ error: "Failed to mark group thread as read", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/outfit-presets", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) return res.status(400).json({ error: "invalid wallet param" });
    const presets = await getOutfitPresets(wallet);
    res.json({ ok: true, walletAddress: wallet, presets });
  } catch (e) {
    console.error("GET /api/users/:wallet/outfit-presets error:", e);
    res.status(500).json({ error: "Failed to load outfit presets", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/outfit-presets", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const parsed = OutfitPresetSchema.safeParse(req.body || {});
    if (!wallet || wallet.length < 6 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid wallet param" : parsed.error.flatten() });
    }
    await saveOutfitPreset(wallet, parsed.data.presetName, parsed.data.layout);
    const presets = await getOutfitPresets(wallet);
    res.json({ ok: true, walletAddress: wallet, presets });
  } catch (e) {
    console.error("POST /api/users/:wallet/outfit-presets error:", e);
    res.status(500).json({ error: "Failed to save outfit preset", details: e?.message || String(e) });
  }
});

app.delete("/api/users/:wallet/outfit-presets/:presetId", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const presetId = Number(req.params.presetId);
    if (!wallet || wallet.length < 6 || !Number.isFinite(presetId) || presetId <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }
    await deleteOutfitPreset(wallet, presetId);
    const presets = await getOutfitPresets(wallet);
    res.json({ ok: true, walletAddress: wallet, presets });
  } catch (e) {
    console.error("DELETE /api/users/:wallet/outfit-presets/:presetId error:", e);
    res.status(500).json({ error: "Failed to delete outfit preset", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/profile-like", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const parsed = LikeActionSchema.safeParse(req.body || {});
    if (!wallet || wallet.length < 6 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid wallet param" : parsed.error.flatten() });
    }
    const likes = await setProfileLike(wallet, parsed.data.likerWallet, parsed.data.liked);
    res.json({ ok: true, walletAddress: wallet, likes });
  } catch (e) {
    console.error("POST /api/users/:wallet/profile-like error:", e);
    res.status(500).json({ error: "Failed to update profile like", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/outfit-like", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const parsed = LikeActionSchema.safeParse(req.body || {});
    if (!wallet || wallet.length < 6 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid wallet param" : parsed.error.flatten() });
    }
    const likes = await setOutfitLike(wallet, parsed.data.likerWallet, parsed.data.liked);
    res.json({ ok: true, walletAddress: wallet, likes });
  } catch (e) {
    console.error("POST /api/users/:wallet/outfit-like error:", e);
    res.status(500).json({ error: "Failed to update outfit like", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/challenge", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = GroupChallengeSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    const wallet = normalizeWalletAddress(parsed.data.walletAddress);
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      return res.status(400).json({ error: "Challenge end must be after start" });
    }
    const targetKm = Number(parsed.data.targetKm);
    if (targetKm < GROUP_CHALLENGE_MIN_KM) {
      return res.status(400).json({ error: `Challenge target must be at least ${GROUP_CHALLENGE_MIN_KM} km` });
    }
    const groupRows = await q(`SELECT id FROM groups_social WHERE id = ? LIMIT 1`, [groupId]);
    if (!groupRows.length) return res.status(404).json({ error: "Group not found" });
    const role = await getGroupMemberRole(groupId, wallet);
    if (!canManageGroupChallenge(role)) {
      return res.status(403).json({ error: "Only the owner or an admin can manage the challenge" });
    }
    await db.query(`UPDATE group_challenges SET is_active = 0, updated_at = NOW() WHERE group_id = ?`, [groupId]);
    await db.query(
      `
      INSERT INTO group_challenges (group_id, title, target_km, created_by_wallet, starts_at, ends_at, bonus_points, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
      `,
      [
        groupId,
        parsed.data.title.trim(),
        targetKm,
        wallet,
        toSqlDateTime(startsAt),
        toSqlDateTime(endsAt),
        computeChallengeBonusPoints(targetKm, startsAt, endsAt),
      ]
    );
    const group = await buildGroupDetails(groupId);
    // notify all group members about the new challenge
    const memberWallets = (group.members || []).map((m) => m.wallet || m.walletAddress).filter(Boolean);
    await Promise.all(
      memberWallets.map((w) =>
        notify(w, {
          type: "group_challenge",
          title: "New group challenge",
          body: `"${parsed.data.title.trim()}" started in your group — ${targetKm} km target.`,
          refType: "group",
          refId: groupId,
        })
      )
    );
    res.json({ ok: true, group });
  } catch (e) {
    console.error("POST /api/groups/:groupId/challenge error:", e);
    res.status(500).json({ error: "Failed to save group challenge", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/crown-claim", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = GroupCrownClaimSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    const result = await claimGroupCrownReward(groupId, parsed.data.walletAddress, parsed.data.txHash, parsed.data.chainId);
    const group = await buildGroupDetails(groupId, parsed.data.walletAddress);
    // notify other group members that crown was claimed
    const claimerWallet = normalizeWalletAddress(parsed.data.walletAddress);
    const otherMembers = (group.members || [])
      .map((m) => normalizeWalletAddress(m.wallet || m.walletAddress))
      .filter((w) => w && w !== claimerWallet);
    await Promise.all(
      otherMembers.map((w) =>
        notify(w, {
          type: "crown_claimed",
          title: "Crown claimed!",
          body: `A team member claimed the Group Crown reward in "${group.name || `Group #${groupId}`}".`,
          refType: "group",
          refId: groupId,
        })
      )
    );
    res.json({ ok: true, group, ...result });
  } catch (e) {
    console.error("POST /api/groups/:groupId/crown-claim error:", e);
    res.status(500).json({ error: "Failed to claim crown reward", details: e?.message || String(e) });
  }
});

app.post("/api/groups/:groupId/roles", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = GroupRoleUpdateSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    await updateGroupMemberRole(groupId, parsed.data.walletAddress, parsed.data.targetWallet, parsed.data.role);
    const group = await buildGroupDetails(groupId, parsed.data.walletAddress);
    res.json({ ok: true, group });
  } catch (e) {
    console.error("POST /api/groups/:groupId/roles error:", e);
    res.status(500).json({ error: "Failed to update group role", details: e?.message || String(e) });
  }
});

app.delete("/api/groups/:groupId/members/:targetWallet", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const targetWallet = normalizeWalletAddress(req.params.targetWallet);
    const parsed = WalletActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !targetWallet || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    await removeGroupMember(groupId, parsed.data.walletAddress, targetWallet);
    const social = await buildSocialSummary(parsed.data.walletAddress);
    res.json({ ok: true, ...social });
  } catch (e) {
    console.error("DELETE /api/groups/:groupId/members/:targetWallet error:", e);
    res.status(500).json({ error: "Failed to remove group member", details: e?.message || String(e) });
  }
});

app.delete("/api/groups/:groupId/leave", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = WalletActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    await leaveGroup(groupId, parsed.data.walletAddress);
    const social = await buildSocialSummary(parsed.data.walletAddress);
    res.json({ ok: true, ...social });
  } catch (e) {
    console.error("DELETE /api/groups/:groupId/leave error:", e);
    res.status(500).json({ error: "Failed to leave group", details: e?.message || String(e) });
  }
});

app.delete("/api/groups/:groupId", async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const parsed = GroupDeleteSchema.safeParse(req.body || {});
    if (!Number.isFinite(groupId) || groupId <= 0 || !parsed.success) {
      return res.status(400).json({ error: parsed.success ? "invalid params" : parsed.error.flatten() });
    }
    await deleteGroup(groupId, parsed.data.walletAddress);
    const social = await buildSocialSummary(parsed.data.walletAddress);
    res.json({ ok: true, ...social });
  } catch (e) {
    console.error("DELETE /api/groups/:groupId error:", e);
    res.status(500).json({ error: "Failed to delete group", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/public-profile", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const viewerWallet = normalizeWalletAddress(req.query.viewer);
    await touchUserPresence(wallet, "public-profile");
    const profile = await buildPublicProfile(wallet, viewerWallet);
    res.json({
      ok: true,
      profile,
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/public-profile error:", e);
    res.status(500).json({ error: "Failed to build public profile", details: e?.message || String(e) });
  }
});

app.get("/api/stats/modes", async (_req, res) => {
  try {
    const wallet = statsWalletFilterFromReq(_req);
    const events = await getAllEventsForStats({ wallet });
    const types = ["bus", "rail", "monorail", "park&ride"];

    const tripsByType = { bus: 0, rail: 0, monorail: 0, "park&ride": 0 };
    const distanceByTypeKm = { bus: 0, rail: 0, monorail: 0, "park&ride": 0 };
    const co2SavedByTypeKg = { bus: 0, rail: 0, monorail: 0, "park&ride": 0 };

    let totalTrips = 0;

    for (const e of events) {
      totalTrips++;
      tripsByType[e.tripType] = (tripsByType[e.tripType] || 0) + 1;
      if (typeof e.distanceKm === "number") distanceByTypeKm[e.tripType] += e.distanceKm;
      co2SavedByTypeKg[e.tripType] += co2SavedKgForEvent(e);
    }

    const modeShareTripsPct = {};
    for (const t of types) {
      modeShareTripsPct[t] =
        totalTrips === 0 ? 0 : Number(((tripsByType[t] / totalTrips) * 100).toFixed(1));
      distanceByTypeKm[t] = Number(distanceByTypeKm[t].toFixed(2));
      co2SavedByTypeKg[t] = Number(co2SavedByTypeKg[t].toFixed(3));
    }

    res.json({
      totalTrips,
      tripsByType,
      distanceByTypeKm,
      co2SavedByTypeKg,
      modeShareTripsPct,
    });
  } catch (e) {
    console.error("GET /api/stats/modes error:", e);
    res.status(500).json({ error: "Failed to build modes stats", details: e?.message || String(e) });
  }
});

app.get("/api/stats/peak-hours", async (_req, res) => {
  try {
    const wallet = statsWalletFilterFromReq(_req);
    const events = await getAllEventsForStats({ wallet });

    const tripsByHour = Array(24).fill(0);
    const distanceByHourKm = Array(24).fill(0);
    const co2ByHourKg = Array(24).fill(0);

    for (const e of events) {
      let ts = null;
      if (typeof e.ts === "number") ts = e.ts;
      else if (e.eventTime) ts = Date.parse(e.eventTime);

      if (!Number.isFinite(ts)) continue;

      const h = new Date(ts).getHours();
      tripsByHour[h] += 1;
      if (typeof e.distanceKm === "number") distanceByHourKm[h] += e.distanceKm;
      co2ByHourKg[h] += co2SavedKgForEvent(e);
    }

    res.json({
      tripsByHour,
      distanceByHourKm: distanceByHourKm.map((x) => Number(x.toFixed(2))),
      co2ByHourKg: co2ByHourKg.map((x) => Number(x.toFixed(3))),
    });
  } catch (e) {
    console.error("GET /api/stats/peak-hours error:", e);
    res.status(500).json({ error: "Failed to build peak-hours stats", details: e?.message || String(e) });
  }
});

app.get("/api/stats/timeseries", async (req, res) => {
  try {
    const bucket = String(req.query.bucket || "minute");
    const window = Number(req.query.window || 60);

    const bucketMs = bucket === "hour" ? 60 * 60 * 1000 : 60 * 1000;
    if (!Number.isFinite(window) || window <= 0 || window > 24 * 60) {
      return res.status(400).json({ error: "window must be a number between 1 and 1440" });
    }

    const end = Date.now();
    const start = end - window * bucketMs;

    const points = Array.from({ length: window }, (_, i) => ({
      t: start + i * bucketMs,
      trips: 0,
      distanceKm: 0,
      co2SavedKg: 0,
    }));

    const wallet = statsWalletFilterFromReq(req);
    const events = await getAllEventsForStats({ wallet });

    for (const e of events) {
      let ts = null;
      if (typeof e.ts === "number") ts = e.ts;
      else if (e.eventTime) ts = Date.parse(e.eventTime);

      if (!Number.isFinite(ts)) continue;
      if (ts < start || ts >= end) continue;

      const idx = Math.floor((ts - start) / bucketMs);
      if (idx < 0 || idx >= points.length) continue;

      points[idx].trips += 1;
      if (typeof e.distanceKm === "number") points[idx].distanceKm += e.distanceKm;
      points[idx].co2SavedKg += co2SavedKgForEvent(e);
    }

    for (const p of points) {
      p.distanceKm = Number(p.distanceKm.toFixed(2));
      p.co2SavedKg = Number(p.co2SavedKg.toFixed(4));
    }

    res.json({ bucket, bucketMs, window, start, end, points });
  } catch (e) {
    console.error("GET /api/stats/timeseries error:", e);
    res.status(500).json({ error: "Failed to build timeseries", details: e?.message || String(e) });
  }
});

app.get("/api/stats/methodology", (_req, res) => {
  res.json({
    title: "CO₂ saved estimation methodology (demo)",
    unit: "gCO2e per passenger-km",
    baseline: "car (average)",
    factors: FACTORS,
    formula: "saved_kg = Σ distance_km * max(0, (car_factor - mode_factor)) / 1000",
    notes: [
      "This is a simplified estimate for demonstration purposes.",
      "Replace emission factors with an official dataset if required.",
      "Values represent averages and do not model occupancy, route gradients, or vehicle mix.",
    ],
  });
});

// ----------------------------------------------------
// ROUTES: USER REWARDS
// ----------------------------------------------------
app.get("/api/users/:wallet/rewards", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const rewards = await computeWalletRewards(wallet);

    res.json({
      ...rewards,
      note: "DB-based reward balance: earned - spent - claimed.",
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/rewards error:", e);
    res.status(500).json({ error: "Failed to compute rewards", details: e?.message || String(e) });
  }
});

// ----------------------------------------------------
// ROUTES: CLAIMS
// ----------------------------------------------------
app.get("/api/users/:wallet/claim-preview", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const rewards = await computeWalletRewards(wallet);

    res.json({
      ok: true,
      wallet,
      token: rewards.token,
      earnedTokens: rewards.earnedTokens,
      spentTokens: rewards.spentTokens,
      claimedTokens: rewards.claimedTokens,
      claimableTokens: rewards.claimableTokens,
      note: "Preview only. Next step is signed/on-chain claim.",
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/claim-preview error:", e);
    res.status(500).json({ error: "Failed to build claim preview", details: e?.message || String(e) });
  }
});

app.get("/api/users/:wallet/claims", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const rows = await q(
      `
      SELECT id, wallet_address, amount_tokens, nonce, expiry_ts_ms, signature_hash, claim_status, tx_hash, chain_id, note, created_at, updated_at
      FROM reward_claims
      WHERE wallet_address = ?
      ORDER BY id DESC
      `,
      [wallet]
    );

    res.json({
      ok: true,
      wallet,
      claims: rows.map((r) => ({
        id: r.id,
        walletAddress: r.wallet_address,
        amountTokens: Number(r.amount_tokens || 0),
        nonce: r.nonce,
        expiryTsMs: r.expiry_ts_ms == null ? null : Number(r.expiry_ts_ms),
        signatureHash: r.signature_hash || null,
        claimStatus: r.claim_status,
        txHash: r.tx_hash || null,
        chainId: r.chain_id == null ? null : Number(r.chain_id),
        note: r.note || null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      })),
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/claims error:", e);
    res.status(500).json({ error: "Failed to fetch claims", details: e?.message || String(e) });
  }
});

app.post("/api/users/:wallet/claim", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }

    const parsed = ClaimCreateSchema.safeParse({
      amountTokens: Number(req.body?.amountTokens),
    });

    if (!parsed.success) {
      return res.status(400).json({ error: "amountTokens must be a positive number" });
    }

    const amountRequested = Number(parsed.data.amountTokens);
    const rewards = await computeWalletRewards(wallet);

    if (amountRequested > rewards.claimableTokens) {
      return res.status(400).json({
        error: "Requested amount exceeds claimable balance",
        details: {
          requested: amountRequested,
          claimable: Number(rewards.claimableTokens.toFixed(3)),
        },
      });
    }

    const insertNonce = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const claimStatus = "submitted";

    const insertResult = await db.query(
      `
      INSERT INTO reward_claims
        (wallet_address, amount_tokens, nonce, expiry_ts_ms, signature_hash, claim_status, tx_hash, chain_id, note, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, NOW(), NOW())
      `,
      [wallet, amountRequested, insertNonce, null, claimStatus, "Claim submitted, waiting for on-chain signature"]
    );

    const claimId = Number(insertResult?.insertId);
    if (!Number.isFinite(claimId) || claimId <= 0) {
      throw new Error("Failed to create claim id");
    }

    const nonce = String(claimId);
    await db.query(
      `
      UPDATE reward_claims
      SET nonce = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [nonce, claimId]
    );

    res.json({
      ok: true,
      claimId,
      wallet,
      amountTokens: Number(amountRequested.toFixed(3)),
      claimStatus,
      nonce,
      expiryTsMs: null,
      remainingAvailable: Number((rewards.claimableTokens - amountRequested).toFixed(3)),
      remainingClaimable: Number((rewards.claimableTokens - amountRequested).toFixed(3)),
      note: "Claim submitted. Next step: sign + on-chain claim.",
    });
  } catch (e) {
    console.error("POST /api/users/:wallet/claim error:", e);
    res.status(500).json({ error: "Failed to create claim", details: e?.message || String(e) });
  }
});

app.post("/api/claims/:id/sign", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }

    const rows = await q(
      `
      SELECT id, wallet_address, amount_tokens, claim_status
      FROM reward_claims
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "claim not found" });

    const claim = rows[0];
    if (claim.claim_status !== "submitted") {
      return res.status(400).json({
        error: "claim must be submitted before signing",
        details: { claimStatus: claim.claim_status },
      });
    }

    const nonce = String(claim.id);
    const expiry = Math.floor(Date.now() / 1000) + GCT_CONFIG.claimExpirySeconds;
    const expiryTsMs = expiry * 1000;
    const amountWei = tokensToWei(claim.amount_tokens);

    const walletAddress = String(claim.wallet_address || "").trim().toLowerCase();
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: "claim wallet address is invalid" });
    }

    const oracleWallet = getOracleWallet();
    const domain = getGctDomain();
    const claimValue = {
      user: walletAddress,
      amount: amountWei,
      nonce: BigInt(nonce),
      expiry: BigInt(expiry),
    };

    const signature = await oracleWallet.signTypedData(domain, GCT_EIP712_TYPES, claimValue);
    const signatureHash = ethers.keccak256(signature);

    await db.query(
      `
      UPDATE reward_claims
      SET nonce = ?,
          expiry_ts_ms = ?,
          signature_hash = ?,
          note = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [nonce, expiryTsMs, signatureHash, "EIP-712 payload signed by backend oracle", id]
    );

    res.json({
      ok: true,
      claimId: id,
      walletAddress,
      amountTokens: Number(claim.amount_tokens || 0),
      amount: amountWei.toString(),
      nonce,
      expiry,
      expiryTsMs,
      signature,
      signatureHash,
      contractAddress: GCT_CONFIG.contractAddress,
      chainId: GCT_CONFIG.chainId,
      tokenSymbol: REWARD_RULES.tokenSymbol,
      decimals: GCT_DECIMALS,
    });
  } catch (e) {
    console.error("POST /api/claims/:id/sign error:", e);
    res.status(500).json({ error: "Failed to sign claim", details: e?.message || String(e) });
  }
});
// ----------------------------------------------------
// ROUTES: CLAIM ADMIN (demo)
// ----------------------------------------------------

// list all claims (admin/demo)
app.get("/api/claims", async (req, res) => {
  try {
    const limit = clamp(Number(req.query.limit || 100), 1, 500);

    const rows = await q(
      `
      SELECT id, wallet_address, amount_tokens, nonce, expiry_ts_ms, claim_status, tx_hash, chain_id, note, created_at, updated_at
      FROM reward_claims
      ORDER BY id DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json({
      ok: true,
      count: rows.length,
      claims: rows.map((r) => ({
        id: r.id,
        walletAddress: r.wallet_address,
        amountTokens: Number(r.amount_tokens || 0),
        nonce: r.nonce,
        expiryTsMs: r.expiry_ts_ms == null ? null : Number(r.expiry_ts_ms),
        claimStatus: r.claim_status,
        txHash: r.tx_hash || null,
        chainId: r.chain_id == null ? null : Number(r.chain_id),
        note: r.note || null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
      })),
    });
  } catch (e) {
    console.error("GET /api/claims error:", e);
    res.status(500).json({ error: "Failed to list claims", details: e?.message || String(e) });
  }
});

// confirm a claim after on-chain tx
app.post("/api/claims/:id/confirm", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });

    const txHashRaw = req.body?.txHash;
    if (!isValidTxHash(txHashRaw)) {
      return res.status(400).json({ error: "txHash is required and must be a valid 0x hash" });
    }
    const txHash = String(txHashRaw).trim();

    const rows = await q(
      `SELECT id, wallet_address, amount_tokens, nonce, claim_status FROM reward_claims WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "claim not found" });

    const claim = rows[0];
    const current = claim.claim_status;
    if (current === "confirmed") {
      return res.json({ ok: true, id, claimStatus: "confirmed", note: "already confirmed", txHash });
    }
    if (current !== "submitted") {
      return res.status(400).json({
        error: "only submitted claims can be confirmed",
        details: { claimStatus: current },
      });
    }

	    const provider = getGctProvider();
	    const tx = await provider.getTransaction(txHash);
	    const receipt = await provider.getTransactionReceipt(txHash);
	    if (!receipt) {
	      return res.status(400).json({ error: "transaction not mined yet" });
	    }
    if (receipt.status !== 1) {
      return res.status(400).json({ error: "transaction reverted", details: { txHash } });
    }

    const expectedWallet = String(claim.wallet_address || "").toLowerCase();
    const expectedAmount = tokensToWei(claim.amount_tokens);
    let expectedNonce;
    try {
      expectedNonce = BigInt(String(claim.nonce));
    } catch {
      return res.status(400).json({ error: "claim nonce is not a valid uint256 value" });
    }

	    let matched = false;
	    let matchedBy = null;
	    for (const log of receipt.logs || []) {
	      if (String(log.address || "").toLowerCase() !== GCT_CONFIG.contractAddress) continue;
	      try {
	        const parsed = gctInterface.parseLog(log);
	        if (!parsed || parsed.name !== "RewardClaimed") continue;

        const eventUser = String(parsed.args.user || "").toLowerCase();
        const eventAmount = parsed.args.amount;
        const eventNonce = parsed.args.nonce;

	        if (
	          eventUser === expectedWallet &&
	          eventAmount === expectedAmount &&
	          eventNonce === expectedNonce
	        ) {
	          matched = true;
	          matchedBy = "RewardClaimed";
	          break;
	        }
	      } catch {
	        // ignore unrelated logs
	      }
	    }

	    if (!matched) {
	      for (const log of receipt.logs || []) {
	        if (String(log.address || "").toLowerCase() !== GCT_CONFIG.contractAddress) continue;
	        try {
	          const parsed = gctErc20Interface.parseLog(log);
	          if (!parsed || parsed.name !== "Transfer") continue;

	          const from = String(parsed.args.from || "").toLowerCase();
	          const to = String(parsed.args.to || "").toLowerCase();
	          const value = parsed.args.value;

	          if (
	            from === ethers.ZeroAddress.toLowerCase() &&
	            to === expectedWallet &&
	            value === expectedAmount
	          ) {
	            matched = true;
	            matchedBy = "TransferMint";
	            break;
	          }
	        } catch {
	          // ignore unrelated logs
	        }
	      }
	    }

	    if (!matched && tx?.to && String(tx.to).toLowerCase() === GCT_CONFIG.contractAddress) {
	      try {
	        const parsedTx = gctWriteInterface.parseTransaction({
	          data: tx.data,
	          value: tx.value,
	        });

	        if (parsedTx?.name === "claimReward") {
	          const txUser = String(parsedTx.args.user || "").toLowerCase();
	          const txAmount = parsedTx.args.amount;
	          const txNonce = parsedTx.args.nonce;

	          if (
	            txUser === expectedWallet &&
	            txAmount === expectedAmount &&
	            txNonce === expectedNonce &&
	            receipt.status === 1
	          ) {
	            matched = true;
	            matchedBy = "claimRewardTxInput";
	          }
	        }
	      } catch {
	        // ignore decode failures
	      }
	    }

	    if (!matched) {
	      return res.status(400).json({
	        error: "RewardClaimed event validation failed for this claim",
	        details: {
	          txHash,
	          claimId: id,
	          expectedWallet,
	          expectedAmount: expectedAmount.toString(),
	          expectedNonce: expectedNonce.toString(),
	        },
	      });
	    }

    await db.query(
      `
      UPDATE reward_claims
      SET claim_status = 'confirmed',
          tx_hash = ?,
          chain_id = ?,
          note = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
	      [txHash, GCT_CONFIG.chainId, `Confirmed from on-chain validation (${matchedBy})`, id]
	    );

    res.json({
      ok: true,
      id,
      claimStatus: "confirmed",
      txHash,
      chainId: GCT_CONFIG.chainId,
	      note: `Claim confirmed from on-chain receipt + validation (${matchedBy})`,
	    });
  } catch (e) {
    console.error("POST /api/claims/:id/confirm error:", e);
    res.status(500).json({ error: "Failed to confirm claim", details: e?.message || String(e) });
  }
});

// fail a claim (admin/demo)
app.post("/api/claims/:id/fail", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid id" });

    const reason = req.body?.reason ? String(req.body.reason) : "Demo: failed by admin";

    const rows = await q(
      `SELECT id, claim_status FROM reward_claims WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "claim not found" });

    const current = rows[0].claim_status;
    if (current === "failed") {
      return res.json({ ok: true, id, claimStatus: "failed", note: "already failed" });
    }

    await db.query(
      `
      UPDATE reward_claims
      SET claim_status = 'failed',
          note = ?,
          updated_at = NOW()
      WHERE id = ?
      `,
      [reason, id]
    );

    res.json({ ok: true, id, claimStatus: "failed" });
  } catch (e) {
    console.error("POST /api/claims/:id/fail error:", e);
    res.status(500).json({ error: "Failed to fail claim", details: e?.message || String(e) });
  }
});
// ----------------------------------------------------
// ROUTES: AVATAR LAYOUT
// ----------------------------------------------------
app.get("/api/avatar-layout/:wallet", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet" });
    }

    await touchUserPresence(wallet, "avatar-view");
    const rows = await q(
      `
      SELECT wallet_address, layout_json, signature, saved_by_source, updated_at, created_at
      FROM avatar_layouts
      WHERE wallet_address = ?
      LIMIT 1
      `,
      [wallet]
    );

    if (!rows.length) {
      return res.json({
        ok: true,
        exists: false,
        walletAddress: wallet,
        layout: null,
      });
    }

    const row = rows[0];
    res.json({
      ok: true,
      exists: true,
      walletAddress: row.wallet_address,
      layout: safeJsonParse(row.layout_json, null),
      signature: row.signature || null,
      savedBySource: row.saved_by_source || "api",
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  } catch (e) {
    console.error("GET /api/avatar-layout/:wallet error:", e);
    res.status(500).json({ error: "Failed to load layout", details: e?.message || String(e) });
  }
});

app.post("/api/avatar-layout", async (req, res) => {
  try {
    const parsed = AvatarLayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const wallet = normalizeWalletAddress(parsed.data.walletAddress);
    const layoutJson = JSON.stringify(parsed.data.layout ?? {});
    const savedBySource = parsed.data.savedBySource ?? "api";
    await touchUserPresence(wallet, "avatar-save");

    await db.query(
      `
      INSERT INTO avatar_layouts (wallet_address, layout_json, signature, saved_by_source, created_at, updated_at)
      VALUES (?, ?, NULL, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        layout_json = VALUES(layout_json),
        saved_by_source = VALUES(saved_by_source),
        updated_at = NOW()
      `,
      [wallet, layoutJson, savedBySource]
    );

    res.json({
      ok: true,
      walletAddress: wallet,
      saved: true,
      savedBySource,
      updatedAt: nowIso(),
    });
  } catch (e) {
    console.error("POST /api/avatar-layout error:", e);
    res.status(500).json({ error: "Failed to save layout", details: e?.message || String(e) });
  }
});

// ----------------------------------------------------
// ROUTES: SHOP PURCHASES / INVENTORY
// ----------------------------------------------------
app.post("/api/shop/purchase", async (req, res) => {
  try {
    const parsed = ShopPurchaseSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid purchase payload",
        details: parsed.error.flatten(),
      });
    }

    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);
    const itemId = parsed.data.itemId;
    const itemName = parsed.data.itemName || null;
    const slotName = parsed.data.slotName || null;
    const priceTokens = Number(parsed.data.priceTokens || 0);
    const metadataJson = parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null;
    const txHash = req.body?.txHash ? String(req.body.txHash).trim() : null;
    const chainId = req.body?.chainId != null ? Number(req.body.chainId) : null;

    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid wallet address",
      });
    }
    if (!isValidTxHash(txHash)) {
      return res.status(400).json({
        ok: false,
        error: "txHash is required and must be a valid 0x hash",
      });
    }
    if (chainId !== GCT_CONFIG.chainId) {
      return res.status(400).json({
        ok: false,
        error: "Invalid chainId for purchase tx",
        details: { expected: GCT_CONFIG.chainId, received: chainId },
      });
    }
    if (!ethers.isAddress(GCT_CONFIG.burnAddress)) {
      return res.status(500).json({
        ok: false,
        error: "Invalid GCT_BURN_ADDRESS configuration",
      });
    }

    const duplicateTxRows = await q(
      `
      SELECT id
      FROM shop_purchases
      WHERE tx_hash = ?
      LIMIT 1
      `,
      [txHash]
    );
    if (duplicateTxRows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "This purchase txHash was already used",
      });
    }

    const provider = getGctProvider();
    // Retry up to 5 times with 2s delay — tx may be mid-propagation when the request arrives
    let receipt = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!receipt) {
      return res.status(400).json({
        ok: false,
        error: "Purchase transaction is not mined yet",
      });
    }
    if (receipt.status !== 1) {
      return res.status(400).json({
        ok: false,
        error: "Purchase transaction reverted",
      });
    }

    const expectedFrom = walletAddress.toLowerCase();
    const expectedTo = GCT_CONFIG.burnAddress.toLowerCase();
    const expectedValue = tokensToWei(priceTokens);

    let transferMatched = false;
    for (const log of receipt.logs || []) {
      if (String(log.address || "").toLowerCase() !== GCT_CONFIG.contractAddress) continue;
      try {
        const parsedLog = gctErc20Interface.parseLog(log);
        if (!parsedLog || parsedLog.name !== "Transfer") continue;

        const from = String(parsedLog.args.from || "").toLowerCase();
        const to = String(parsedLog.args.to || "").toLowerCase();
        const value = parsedLog.args.value;

        if (from === expectedFrom && to === expectedTo && value === expectedValue) {
          transferMatched = true;
          break;
        }
      } catch {
        // ignore unrelated logs
      }
    }

    if (!transferMatched) {
      return res.status(400).json({
        ok: false,
        error: "Purchase tx has no matching burn Transfer event",
        details: {
          expectedFrom,
          expectedTo,
          expectedValue: expectedValue.toString(),
        },
      });
    }

    const existingRows = await q(
      `
      SELECT id, wallet_address, item_id, created_at
      FROM shop_purchases
      WHERE wallet_address = ? AND item_id = ?
      LIMIT 1
      `,
      [walletAddress, itemId]
    );

    if (existingRows.length > 0) {
      return res.json({
        ok: true,
        alreadyOwned: true,
        purchase: {
          id: existingRows[0].id,
          walletAddress: existingRows[0].wallet_address,
          itemId: existingRows[0].item_id,
          createdAt:
            existingRows[0].created_at instanceof Date
              ? existingRows[0].created_at.toISOString()
              : existingRows[0].created_at,
        },
      });
    }

    const nftGrant = await ensureWalletOwnsCosmeticItemOnChain(walletAddress, itemId);
    const finalMetadata = JSON.stringify({
      ...(parsed.data.metadata || {}),
      cosmeticTokenId: nftGrant?.tokenId ?? null,
      cosmeticMintTxHash: nftGrant?.txHash ?? null,
      cosmeticMetadataUri: nftGrant?.metadataUri ?? null,
      tokenStandard: nftGrant?.configured ? "ERC-1155" : null,
    });

    await db.query(
      `
      INSERT INTO shop_purchases
        (wallet_address, item_id, item_name, slot_name, price_tokens, purchase_mode, tx_hash, chain_id, metadata_json, created_at)
      VALUES
        (?, ?, ?, ?, ?, 'onchain', ?, ?, ?, NOW())
      `,
      [walletAddress, itemId, itemName, slotName, priceTokens, txHash, GCT_CONFIG.chainId, finalMetadata || metadataJson]
    );

    return res.json({
      ok: true,
      alreadyOwned: false,
      saved: true,
      walletAddress,
      itemId,
      nft: {
        tokenId: nftGrant?.tokenId ?? null,
        mintTxHash: nftGrant?.txHash ?? null,
        tokenStandard: nftGrant?.configured ? "ERC-1155" : null,
      },
      txHash,
      chainId: GCT_CONFIG.chainId,
    });
  } catch (err) {
    console.error("POST /api/shop/purchase error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to save purchase",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/cosmetics/transfer/confirm", async (req, res) => {
  try {
    const parsed = CosmeticTransferConfirmSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid cosmetic transfer payload",
        details: parsed.error.flatten(),
      });
    }

    const fromWallet = normalizeWalletAddress(parsed.data.fromWallet);
    const toWallet = normalizeWalletAddress(parsed.data.toWallet);
    const itemId = String(parsed.data.itemId || "").trim();

    if (fromWallet === toWallet) {
      return res.status(400).json({ ok: false, error: "Recipient wallet must be different" });
    }
    if (!ethers.isAddress(fromWallet) || !ethers.isAddress(toWallet)) {
      return res.status(400).json({ ok: false, error: "Invalid transfer wallet address" });
    }

    const validation = await confirmCosmeticTransferOnChain({
      txHash: parsed.data.txHash,
      chainId: parsed.data.chainId,
      fromWallet,
      toWallet,
      itemId,
    });

    const item = getAvatarItemById(itemId);
    const metadata = JSON.stringify({
      itemName: item?.name || itemId,
      slotName: item?.slot || null,
      cosmeticMetadataUri: getCosmeticMetadataUri(itemId),
    });

    await db.query(
      `
      INSERT INTO cosmetic_transfers
        (tx_hash, chain_id, item_id, token_id, from_wallet, to_wallet, operator_wallet, amount, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        chain_id = VALUES(chain_id),
        item_id = VALUES(item_id),
        token_id = VALUES(token_id),
        from_wallet = VALUES(from_wallet),
        to_wallet = VALUES(to_wallet),
        operator_wallet = VALUES(operator_wallet),
        amount = VALUES(amount),
        metadata_json = VALUES(metadata_json)
      `,
      [
        validation.txHash,
        validation.chainId,
        itemId,
        validation.tokenId,
        fromWallet,
        toWallet,
        validation.operatorWallet,
        validation.amount,
        metadata,
      ]
    );

    return res.json({
      ok: true,
      itemId,
      tokenId: validation.tokenId,
      txHash: validation.txHash,
      fromWallet,
      toWallet,
    });
  } catch (err) {
    console.error("POST /api/cosmetics/transfer/confirm error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to confirm cosmetic transfer",
      details: err?.message || String(err),
    });
  }
});

app.get("/api/trades", async (req, res) => {
  try {
    const walletAddress = req.query?.wallet ? normalizeWalletAddress(req.query.wallet) : null;
    const hub = await getTradeHubData(walletAddress);
    return res.json({
      ok: true,
      walletAddress,
      ...hub,
    });
  } catch (err) {
    console.error("GET /api/trades error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load trade hub",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/trades/listings", async (req, res) => {
  try {
    const parsed = TradeListingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid trade listing payload",
        details: parsed.error.flatten(),
      });
    }

    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);
    const itemId = String(parsed.data.itemId || "").trim();
    const note = parsed.data.note ? String(parsed.data.note).trim() : null;

    if (!await doesWalletOwnItem(walletAddress, itemId)) {
      return res.status(400).json({ ok: false, error: "You do not currently own this item" });
    }

    const existing = await q(
      `
      SELECT id
      FROM trade_listings
      WHERE owner_wallet = ? AND item_id = ? AND listing_status = 'open'
      LIMIT 1
      `,
      [walletAddress, itemId]
    );
    if (existing.length) {
      return res.status(400).json({ ok: false, error: "This item is already listed for trade" });
    }

    await db.query(
      `
      INSERT INTO trade_listings (owner_wallet, item_id, note, listing_status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', NOW(), NOW())
      `,
      [walletAddress, itemId, note]
    );

    const hub = await getTradeHubData(walletAddress);
    return res.json({ ok: true, ...hub });
  } catch (err) {
    console.error("POST /api/trades/listings error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to create trade listing",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/trades/listings/:listingId/offers", async (req, res) => {
  try {
    const listingId = Number(req.params.listingId);
    const parsed = TradeOfferSchema.safeParse(req.body || {});
    if (!Number.isFinite(listingId) || listingId <= 0 || !parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.success ? "Invalid listing id" : "Invalid trade offer payload",
        details: parsed.success ? undefined : parsed.error.flatten(),
      });
    }

    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);
    const offeredItemId = String(parsed.data.offeredItemId || "").trim();
    const note = parsed.data.note ? String(parsed.data.note).trim() : null;

    const listingRows = await q(
      `
      SELECT id, owner_wallet, item_id, listing_status
      FROM trade_listings
      WHERE id = ?
      LIMIT 1
      `,
      [listingId]
    );
    if (!listingRows.length) {
      return res.status(404).json({ ok: false, error: "Trade listing not found" });
    }
    const listing = listingRows[0];
    if (listing.listing_status !== "open") {
      return res.status(400).json({ ok: false, error: "Trade listing is not open" });
    }
    if (normalizeWalletAddress(listing.owner_wallet) === walletAddress) {
      return res.status(400).json({ ok: false, error: "You cannot send an offer to your own listing" });
    }
    if (!await doesWalletOwnItem(walletAddress, offeredItemId)) {
      return res.status(400).json({ ok: false, error: "You do not currently own the offered item" });
    }

    const existing = await q(
      `
      SELECT id
      FROM trade_offers
      WHERE listing_id = ? AND offerer_wallet = ? AND offered_item_id = ? AND offer_status = 'pending'
      LIMIT 1
      `,
      [listingId, walletAddress, offeredItemId]
    );
    if (existing.length) {
      return res.status(400).json({ ok: false, error: "You already sent this offer" });
    }

    await db.query(
      `
      INSERT INTO trade_offers (listing_id, offerer_wallet, offered_item_id, note, offer_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', NOW(), NOW())
      `,
      [listingId, walletAddress, offeredItemId, note]
    );

    const listingOwner = normalizeWalletAddress(listing.owner_wallet);
    const offeredItem = getAvatarItemById(offeredItemId);
    const wantedItem = getAvatarItemById(listing.item_id);
    await notify(listingOwner, {
      type: "trade_offer",
      title: "New trade offer",
      body: `Someone offered "${offeredItem?.name || offeredItemId}" for your "${wantedItem?.name || listing.item_id}".`,
      refType: "trade_listing",
      refId: listingId,
    });

    const hub = await getTradeHubData(walletAddress);
    return res.json({ ok: true, ...hub });
  } catch (err) {
    console.error("POST /api/trades/listings/:listingId/offers error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to send trade offer",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/trades/offers/:offerId/accept", async (req, res) => {
  try {
    const offerId = Number(req.params.offerId);
    const parsed = TradeActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(offerId) || offerId <= 0 || !parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.success ? "Invalid offer id" : parsed.error.flatten() });
    }
    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);

    const rows = await q(
      `
      SELECT o.id, o.listing_id, o.offer_status, o.offerer_wallet, o.offered_item_id, l.owner_wallet, l.item_id, l.listing_status
      FROM trade_offers o
      JOIN trade_listings l ON l.id = o.listing_id
      WHERE o.id = ?
      LIMIT 1
      `,
      [offerId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "Trade offer not found" });
    const offer = rows[0];
    if (normalizeWalletAddress(offer.owner_wallet) !== walletAddress) {
      return res.status(403).json({ ok: false, error: "Only the listing owner can accept this offer" });
    }
    if (offer.offer_status !== "pending") {
      return res.status(400).json({ ok: false, error: "Trade offer is no longer pending" });
    }
    if (offer.listing_status !== "open") {
      return res.status(400).json({ ok: false, error: "Trade listing is no longer open" });
    }

    const swap = await executeCosmeticTradeSwap({
      listingOwnerWallet: offer.owner_wallet,
      listingItemId: offer.item_id,
      offererWallet: offer.offerer_wallet,
      offeredItemId: offer.offered_item_id,
    });

    await db.query(`UPDATE trade_offers SET offer_status = 'accepted', updated_at = NOW() WHERE id = ?`, [offerId]);
    await db.query(
      `UPDATE trade_offers SET offer_status = 'rejected', updated_at = NOW() WHERE listing_id = ? AND id <> ? AND offer_status = 'pending'`,
      [offer.listing_id, offerId]
    );
    await db.query(`UPDATE trade_listings SET listing_status = 'accepted', updated_at = NOW() WHERE id = ?`, [offer.listing_id]);

    const offeredItemMeta = getAvatarItemById(offer.offered_item_id);
    const listedItemMeta = getAvatarItemById(offer.item_id);
    await notify(normalizeWalletAddress(offer.offerer_wallet), {
      type: "trade_accepted",
      title: "Trade accepted!",
      body: `Your offer of "${offeredItemMeta?.name || offer.offered_item_id}" was accepted. You received "${listedItemMeta?.name || offer.item_id}".`,
      refType: "trade_listing",
      refId: offer.listing_id,
    });

    const hub = await getTradeHubData(walletAddress);
    return res.json({ ok: true, swap, ...hub });
  } catch (err) {
    console.error("POST /api/trades/offers/:offerId/accept error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to accept trade offer",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/trades/offers/:offerId/reject", async (req, res) => {
  try {
    const offerId = Number(req.params.offerId);
    const parsed = TradeActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(offerId) || offerId <= 0 || !parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.success ? "Invalid offer id" : parsed.error.flatten() });
    }
    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);

    const rows = await q(
      `
      SELECT o.id, o.offer_status, l.owner_wallet
      FROM trade_offers o
      JOIN trade_listings l ON l.id = o.listing_id
      WHERE o.id = ?
      LIMIT 1
      `,
      [offerId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: "Trade offer not found" });
    const offer = rows[0];
    if (normalizeWalletAddress(offer.owner_wallet) !== walletAddress) {
      return res.status(403).json({ ok: false, error: "Only the listing owner can reject this offer" });
    }
    if (offer.offer_status !== "pending") {
      return res.status(400).json({ ok: false, error: "Trade offer is no longer pending" });
    }

    await db.query(`UPDATE trade_offers SET offer_status = 'rejected', updated_at = NOW() WHERE id = ?`, [offerId]);

    const rows2 = await q(
      `SELECT o.offerer_wallet, o.offered_item_id, l.item_id, l.id AS listing_id FROM trade_offers o JOIN trade_listings l ON l.id = o.listing_id WHERE o.id = ? LIMIT 1`,
      [offerId]
    );
    if (rows2.length) {
      const r = rows2[0];
      const offeredMeta = getAvatarItemById(r.offered_item_id);
      await notify(normalizeWalletAddress(r.offerer_wallet), {
        type: "trade_rejected",
        title: "Trade offer declined",
        body: `Your offer of "${offeredMeta?.name || r.offered_item_id}" was declined.`,
        refType: "trade_listing",
        refId: r.listing_id,
      });
    }

    const hub = await getTradeHubData(walletAddress);
    return res.json({ ok: true, ...hub });
  } catch (err) {
    console.error("POST /api/trades/offers/:offerId/reject error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to reject trade offer",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/trades/listings/:listingId/cancel", async (req, res) => {
  try {
    const listingId = Number(req.params.listingId);
    const parsed = TradeActionSchema.safeParse(req.body || {});
    if (!Number.isFinite(listingId) || listingId <= 0 || !parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.success ? "Invalid listing id" : parsed.error.flatten() });
    }
    const walletAddress = normalizeWalletAddress(parsed.data.walletAddress);

    const rows = await q(`SELECT id, owner_wallet, listing_status FROM trade_listings WHERE id = ? LIMIT 1`, [listingId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Trade listing not found" });
    const listing = rows[0];
    if (normalizeWalletAddress(listing.owner_wallet) !== walletAddress) {
      return res.status(403).json({ ok: false, error: "Only the listing owner can cancel the listing" });
    }
    if (listing.listing_status !== "open") {
      return res.status(400).json({ ok: false, error: "Only open listings can be cancelled" });
    }

    await db.query(`UPDATE trade_listings SET listing_status = 'cancelled', updated_at = NOW() WHERE id = ?`, [listingId]);
    await db.query(
      `UPDATE trade_offers SET offer_status = 'cancelled', updated_at = NOW() WHERE listing_id = ? AND offer_status = 'pending'`,
      [listingId]
    );

    const hub = await getTradeHubData(walletAddress);
    return res.json({ ok: true, ...hub });
  } catch (err) {
    console.error("POST /api/trades/listings/:listingId/cancel error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to cancel trade listing",
      details: err?.message || String(err),
    });
  }
});

app.get("/api/users/:wallet/purchases", async (req, res) => {
  try {
    const walletAddress = normalizeWalletAddress(req.params.wallet);

    if (!walletAddress || walletAddress.length < 3) {
      return res.status(400).json({ ok: false, error: "invalid wallet" });
    }

    const rows = await q(
      `
      SELECT id, wallet_address, item_id, item_name, slot_name, price_tokens, purchase_mode, metadata_json, created_at
      FROM shop_purchases
      WHERE wallet_address = ?
      ORDER BY id DESC
      `,
      [walletAddress]
    );

    res.json({
      ok: true,
      walletAddress,
      purchases: rows.map((r) => ({
        id: r.id,
        walletAddress: r.wallet_address,
        itemId: r.item_id,
        itemName: r.item_name,
        slotName: r.slot_name,
        priceTokens: Number(r.price_tokens || 0),
        purchaseMode: r.purchase_mode,
        metadata: r.metadata_json ? safeJsonParse(r.metadata_json, null) : null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
    });
  } catch (err) {
    console.error("GET /api/users/:wallet/purchases error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to fetch purchases",
      details: err?.message || String(err),
    });
  }
});

app.get("/api/users/:wallet/inventory", async (req, res) => {
  try {
    const walletAddress = normalizeWalletAddress(req.params.wallet);

    if (!walletAddress || walletAddress.length < 3) {
      return res.status(400).json({ ok: false, error: "invalid wallet" });
    }

    const rows = await q(
      `
      SELECT item_id, item_name, slot_name, price_tokens, created_at
      FROM shop_purchases
      WHERE wallet_address = ?
      ORDER BY id ASC
      `,
      [walletAddress]
    );

    const allFromDb = rows.map((r) => r.item_id);
    const ownedFromChain = await getOnChainOwnedCosmeticItemIds(walletAddress);
    // If contract is configured but chain returned nothing (e.g. after Hardhat reset),
    // fall back to DB records so owned items are always visible.
    const chainIsEmpty = hasCosmeticsContractConfigured() && ownedFromChain.length === 0;
    const ownedFromDb = allFromDb.filter(
      (itemId) => !hasCosmeticsContractConfigured() || chainIsEmpty || !isTokenizedAvatarItem(itemId)
    );
    const ownedItemIds = [...new Set([...ownedFromDb, ...ownedFromChain])];

    res.json({
      ok: true,
      walletAddress,
      ownedItemIds,
      ownedItemIdsOnChain: ownedFromChain,
      cosmetics: {
        configured: hasCosmeticsContractConfigured(),
        contractAddress: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.contractAddress : null,
        chainId: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.chainId : null,
      },
      purchases: rows.map((r) => ({
        itemId: r.item_id,
        itemName: r.item_name,
        slotName: r.slot_name,
        priceTokens: Number(r.price_tokens || 0),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
    });
  } catch (err) {
    console.error("GET /api/users/:wallet/inventory error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to fetch inventory",
      details: err?.message || String(err),
    });
  }
});

app.post("/api/users/:wallet/cosmetics/sync", async (req, res) => {
  try {
    const walletAddress = normalizeWalletAddress(req.params.wallet);

    if (!walletAddress || walletAddress.length < 3 || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ ok: false, error: "invalid wallet" });
    }

    const sync = await syncOwnedCosmeticsToChain(walletAddress);
    const inventoryRows = await q(
      `
      SELECT item_id
      FROM shop_purchases
      WHERE wallet_address = ?
      ORDER BY id ASC
      `,
      [walletAddress]
    );
    const allFromDb = inventoryRows.map((row) => row.item_id);
    const ownedFromChain = await getOnChainOwnedCosmeticItemIds(walletAddress);
    const chainIsEmpty = hasCosmeticsContractConfigured() && ownedFromChain.length === 0;
    const ownedFromDb = allFromDb.filter(
      (itemId) => !hasCosmeticsContractConfigured() || chainIsEmpty || !isTokenizedAvatarItem(itemId)
    );
    const ownedItemIds = [...new Set([...ownedFromDb, ...ownedFromChain])];

    return res.json({
      ok: true,
      walletAddress,
      sync,
      ownedItemIds,
      ownedItemIdsOnChain: ownedFromChain,
      cosmetics: {
        configured: hasCosmeticsContractConfigured(),
        contractAddress: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.contractAddress : null,
        chainId: hasCosmeticsContractConfigured() ? COSMETICS_CONFIG.chainId : null,
      },
    });
  } catch (err) {
    console.error("POST /api/users/:wallet/cosmetics/sync error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to sync owned cosmetics to NFTs",
      details: err?.message || String(err),
    });
  }
});


// ----------------------------------------------------
// ROUTES: DUMMY CONTROL
// ----------------------------------------------------
app.get("/api/dummy/status", (_req, res) => {
  res.json({
    running: dummyState.running,
    minMs: dummyState.minMs,
    maxMs: dummyState.maxMs,
    sent: dummyState.sent,
  });
});

app.post("/api/dummy/config", (req, res) => {
  const minMs = Number(req.body?.minMs);
  const maxMs = Number(req.body?.maxMs);

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return res.status(400).json({ error: "minMs and maxMs are required numbers" });
  }
  if (minMs < 1000 || maxMs > 60000 || minMs > maxMs) {
    return res.status(400).json({ error: "invalid range (1s..60s) and min<=max" });
  }

  dummyState.minMs = minMs;
  dummyState.maxMs = maxMs;

  if (dummyState.running) {
    if (dummyState.timer) clearTimeout(dummyState.timer);
    scheduleNextDummySend();
  }

  res.json({
    ok: true,
    running: dummyState.running,
    minMs,
    maxMs,
    sent: dummyState.sent,
  });
});

app.post("/api/dummy/start", (req, res) => {
  const minMs = req.body?.minMs !== undefined ? Number(req.body.minMs) : dummyState.minMs;
  const maxMs = req.body?.maxMs !== undefined ? Number(req.body.maxMs) : dummyState.maxMs;

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 1000 || maxMs > 60000 || minMs > maxMs) {
    return res.status(400).json({ error: "invalid range" });
  }

  dummyState.minMs = minMs;
  dummyState.maxMs = maxMs;

  if (!dummyState.running) {
    dummyState.running = true;
    scheduleNextDummySend();
  }

  res.json({
    ok: true,
    running: dummyState.running,
    minMs: dummyState.minMs,
    maxMs: dummyState.maxMs,
    sent: dummyState.sent,
  });
});

app.post("/api/dummy/stop", (_req, res) => {
  stopDummy();
  res.json({
    ok: true,
    running: dummyState.running,
    minMs: dummyState.minMs,
    maxMs: dummyState.maxMs,
    sent: dummyState.sent,
  });
});

app.post("/api/dummy/once", async (_req, res) => {
  try {
    const body = makeDummyEvent();
    const inserted = await insertEventToDb(body);
    dummyState.sent++;
    res.json({ ok: true, eventId: inserted.eventId });
  } catch (e) {
    console.error("POST /api/dummy/once error:", e);
    res.status(500).json({ error: "Failed to generate dummy event", details: e?.message || String(e) });
  }
});

// ----------------------------------------------------
// NOTIFICATIONS ENDPOINTS
// ----------------------------------------------------
app.get("/api/users/:wallet/notifications", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const rows = await q(
      `SELECT id, type, title, body, ref_type, ref_id, is_read, created_at
       FROM notifications
       WHERE wallet_address = ?
       ORDER BY id DESC
       LIMIT ?`,
      [wallet, limit]
    );
    const unreadCount = rows.filter((r) => !r.is_read).length;
    res.json({
      ok: true,
      walletAddress: wallet,
      unreadCount,
      notifications: rows.map((r) => ({
        id: Number(r.id),
        type: r.type,
        title: r.title,
        body: r.body,
        refType: r.ref_type,
        refId: r.ref_id ? Number(r.ref_id) : null,
        isRead: Boolean(r.is_read),
        createdAt: toIsoMaybe(r.created_at),
      })),
    });
  } catch (e) {
    console.error("GET /api/users/:wallet/notifications error:", e);
    res.status(500).json({ error: "Failed to fetch notifications", details: e?.message || String(e) });
  }
});

app.patch("/api/users/:wallet/notifications/read-all", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    if (!wallet || wallet.length < 6) {
      return res.status(400).json({ error: "invalid wallet param" });
    }
    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE wallet_address = ? AND is_read = 0`,
      [wallet]
    );
    res.json({ ok: true, walletAddress: wallet });
  } catch (e) {
    console.error("PATCH /api/users/:wallet/notifications/read-all error:", e);
    res.status(500).json({ error: "Failed to mark notifications as read", details: e?.message || String(e) });
  }
});

app.patch("/api/users/:wallet/notifications/:id/read", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const id = Number(req.params.id);
    if (!wallet || wallet.length < 6 || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }
    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND wallet_address = ?`,
      [id, wallet]
    );
    res.json({ ok: true, walletAddress: wallet, id });
  } catch (e) {
    console.error("PATCH /api/users/:wallet/notifications/:id/read error:", e);
    res.status(500).json({ error: "Failed to mark notification as read", details: e?.message || String(e) });
  }
});

app.delete("/api/users/:wallet/notifications/:id", async (req, res) => {
  try {
    const wallet = normalizeWalletAddress(req.params.wallet);
    const id = Number(req.params.id);
    if (!wallet || wallet.length < 6 || !Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "invalid params" });
    }

    const result = await db.query(
      `DELETE FROM notifications WHERE id = ? AND wallet_address = ? LIMIT 1`,
      [id, wallet]
    );

    res.json({
      ok: true,
      walletAddress: wallet,
      id,
      deleted: Number(result?.affectedRows || 0) > 0,
    });
  } catch (e) {
    console.error("DELETE /api/users/:wallet/notifications/:id error:", e);
    res.status(500).json({ error: "Failed to delete notification", details: e?.message || String(e) });
  }
});

// ----------------------------------------------------
// ADMIN: seed events for a wallet
// ----------------------------------------------------
app.post("/api/admin/seed-wallet", async (req, res) => {
  const { wallet, trips = 50 } = req.body || {};
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
    return res.status(400).json({ error: "wallet must be a valid 0x address" });
  }
  const tripTypes = ["bus", "rail", "monorail", "park&ride"];
  const count = Math.min(Number(trips) || 50, 500);
  const inserted = [];
  for (let i = 0; i < count; i++) {
    const body = {
      walletAddress: wallet.toLowerCase(),
      tripType: tripTypes[i % tripTypes.length],
      distanceKm: Number((Math.random() * 15 + 2).toFixed(2)),
      routeId: "R-" + Math.floor(Math.random() * 30 + 1),
      stopId: "S-" + Math.floor(Math.random() * 200 + 1),
      source: "admin-seed",
      ts: Date.now() - i * 3_600_000,
    };
    try {
      const r = await fetch(`http://localhost:${PORT}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      inserted.push(j?.eventId || null);
    } catch {
      // skip individual failures
    }
  }
  res.json({ ok: true, wallet: wallet.toLowerCase(), requested: count, inserted: inserted.length });
});

// ----------------------------------------------------
// START
// ----------------------------------------------------
async function start() {
  try {
    await ensureUserProfilesTable();
    await ensureFriendRequestsTable();
    await ensureGroupsTables();
    await ensureDirectMessagesTable();
    await ensureGroupMessagesTable();
    await ensureAvatarSocialFeatureTables();
    app.listen(PORT, () => {
      console.log(`green-api on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error("Failed to start green-api:", e);
    process.exit(1);
  }
}

start();
