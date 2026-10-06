"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";
import { sepolia } from "wagmi/chains";
import { useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { useWallet } from "../../lib/useWallet";
import { addOwned, isOwned, loadInventory, saveInventory } from "../lib/inventory";
import {
  AVATAR_SHOP_SLOTS,
  AVATAR_SLOT_HINTS,
  AVATAR_SLOT_ICONS,
  AVATAR_SLOT_LABELS,
  createEmptySlotMap,
} from "../lib/avatarConfig";
import { getItemRarity, getItemTheme, shortAddr } from "../lib/api";
import { getCosmeticToken } from "../lib/cosmetics";
import Nav from "../components/Nav";
import { greenCommuteTokenAbi } from "../../lib/greenCommuteTokenAbi";
import { greenCommuteCosmeticsAbi } from "../../lib/greenCommuteCosmeticsAbi";

const API =
  typeof window !== "undefined"
    ? "/api-proxy"
    : process.env.NEXT_PUBLIC_GREEN_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4100";

function groupBySlot(items) {
  const map = createEmptySlotMap();
  for (const it of items) {
    (map[it.slot] || (map[it.slot] = [])).push(it);
  }
  return map;
}

function formatTradeStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (!raw) return "Unknown";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getTradeStatusVisual(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "accepted") {
    return {
      icon: "✓",
      style: {
        background: "rgba(34,197,94,.14)",
        border: "1px solid rgba(34,197,94,.28)",
        color: "rgba(220,252,231,.95)",
      },
    };
  }
  if (raw === "rejected") {
    return {
      icon: "×",
      style: {
        background: "rgba(239,68,68,.14)",
        border: "1px solid rgba(239,68,68,.28)",
        color: "rgba(254,226,226,.95)",
      },
    };
  }
  if (raw === "cancelled") {
    return {
      icon: "−",
      style: {
        background: "rgba(148,163,184,.12)",
        border: "1px solid rgba(148,163,184,.22)",
        color: "rgba(226,232,240,.94)",
      },
    };
  }
  if (raw === "pending" || raw === "open") {
    return {
      icon: "•",
      style: {
        background: "rgba(59,130,246,.14)",
        border: "1px solid rgba(59,130,246,.22)",
        color: "rgba(219,234,254,.95)",
      },
    };
  }
  return {
    icon: "•",
    style: {
      background: "rgba(255,255,255,.06)",
      border: "1px solid rgba(255,255,255,.12)",
      color: "rgba(255,255,255,.9)",
    },
  };
}

function formatTradeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("hu-HU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default function ShopPage() {
  const { address, isConnected, isEmbedded, smartClient } = useWallet();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: sepolia.id });

  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState([]);
  const [inv, setInv] = useState(null);
  const [ownedOnChainIds, setOwnedOnChainIds] = useState([]);
  const [rewards, setRewards] = useState(null);
  const [activeTab, setActiveTab] = useState("shop");
  const [tradeHub, setTradeHub] = useState({
    openListings: [],
    myListings: [],
    incomingOffers: [],
    outgoingOffers: [],
    cosmeticsContractAddress: null,
    cosmeticsChainId: null,
    tradeOperatorAddress: null,
    tradeApprovalRequired: false,
    viewerTradeApproved: false,
  });
  const [listingItemId, setListingItemId] = useState("");
  const [listingNote, setListingNote] = useState("");
  const [tradeBusy, setTradeBusy] = useState("");
  const [buyBusy, setBuyBusy] = useState("");
  const [offerSelections, setOfferSelections] = useState({});
  const [offerNotes, setOfferNotes] = useState({});
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const addressKey = isConnected && address ? address.toLowerCase() : "guest";
  const activeCharacter = inv?.equipped?.character || "girl";

  useEffect(() => {
    setMounted(true);
  }, []);

  async function loadItems() {
    const res = await fetch("/items/items.json", { cache: "no-store" });
    const json = await res.json();
    setItems(
      Array.isArray(json)
        ? json.filter((item) => !Array.isArray(item?.tags) || !item.tags.includes("reward"))
        : []
    );
  }

  async function loadRewards(addr) {
    const json = await fetchJson(`${API}/api/users/${addr}/rewards`, { cache: "no-store" });
    setRewards(json);
  }

  async function syncInventoryFromApi(addr) {
    const json = await fetchJson(`${API}/api/users/${addr}/inventory`, { cache: "no-store" });

    const local = loadInventory(addressKey);
    const merged = structuredClone(local);
    merged.owned = Array.isArray(json?.ownedItemIds) ? json.ownedItemIds : [];
    setOwnedOnChainIds(Array.isArray(json?.ownedItemIdsOnChain) ? json.ownedItemIdsOnChain : []);

    saveInventory(addressKey, merged);
    setInv(merged);
  }

  async function loadTradeHub(addr) {
    const query = addr ? `?wallet=${encodeURIComponent(addr)}` : "";
    const json = await fetchJson(`${API}/api/trades${query}`, { cache: "no-store" });
    setTradeHub({
      openListings: json?.openListings || [],
      myListings: json?.myListings || [],
      incomingOffers: json?.incomingOffers || [],
      outgoingOffers: json?.outgoingOffers || [],
      cosmeticsContractAddress: json?.cosmeticsContractAddress || null,
      cosmeticsChainId: json?.cosmeticsChainId || null,
      tradeOperatorAddress: json?.tradeOperatorAddress || null,
      tradeApprovalRequired: Boolean(json?.tradeApprovalRequired),
      viewerTradeApproved: Boolean(json?.viewerTradeApproved),
    });
  }

  useEffect(() => {
    loadItems().catch((e) => {
      console.error("Failed to load items:", e);
      setErr(String(e?.message || e));
    });
  }, []);

  useEffect(() => {
    const loaded = loadInventory(addressKey);
    setInv(loaded);
    setSuccess("");
    setErr("");

    if (isConnected && address) {
      Promise.all([loadRewards(address), syncInventoryFromApi(address), loadTradeHub(address)]).catch((e) =>
        setErr(String(e?.message || e)),
      );
    } else {
      setRewards(null);
      setOwnedOnChainIds([]);
      setTradeHub({
        openListings: [],
        myListings: [],
        incomingOffers: [],
        outgoingOffers: [],
        cosmeticsContractAddress: null,
        cosmeticsChainId: null,
        tradeOperatorAddress: null,
        tradeApprovalRequired: false,
        viewerTradeApproved: false,
      });
    }
  }, [isConnected, address, addressKey]);

  const available = rewards?.spendableTokensOnChain ?? rewards?.onChainBalanceTokens ?? null;
  const grouped = useMemo(() => groupBySlot(items), [items]);
  const ownedOnChainItems = useMemo(() => {
    const ownedSet = new Set(ownedOnChainIds);
    return items.filter((item) => ownedSet.has(item.id));
  }, [items, ownedOnChainIds]);
  const activeMyListings = useMemo(
    () => tradeHub.myListings.filter((listing) => listing.status === "open"),
    [tradeHub.myListings]
  );
  const activeOutgoingOffers = useMemo(
    () => tradeHub.outgoingOffers.filter((offer) => offer.status === "pending"),
    [tradeHub.outgoingOffers]
  );
  const tradeHistory = useMemo(() => {
    const historyEntries = [];

    for (const listing of tradeHub.myListings) {
      if (listing.status !== "open") {
        historyEntries.push({
          id: `listing-${listing.id}`,
          kind: "listing",
          status: listing.status,
          updatedAt: listing.updatedAt || listing.createdAt || null,
          title: listing.item?.name || listing.itemId,
          subtitle: listing.note || "No listing note.",
          image: listing.item?.image || "",
        });
      }

      for (const offer of listing.offers || []) {
        if (offer.status !== "pending") {
          historyEntries.push({
            id: `incoming-${offer.id}`,
            kind: "incoming",
            status: offer.status,
            updatedAt: offer.updatedAt || offer.createdAt || listing.updatedAt || null,
            title: `${offer.offeredItem?.name || offer.offeredItemId} from ${offer.offerer?.customDisplayName || offer.offererWallet}`,
            subtitle: offer.note || "No note.",
            image: offer.offeredItem?.image || "",
          });
        }
      }
    }

    for (const offer of tradeHub.outgoingOffers) {
      if (offer.status !== "pending") {
        historyEntries.push({
          id: `outgoing-${offer.id}`,
          kind: "outgoing",
          status: offer.status,
          updatedAt: offer.updatedAt || offer.createdAt || null,
          title: `${offer.offeredItem?.name || offer.offeredItemId} -> ${offer.listing?.item?.name || offer.listingId}`,
          subtitle: offer.note || "No note.",
          image: offer.offeredItem?.image || "",
        });
      }
    }

    return historyEntries.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [tradeHub.myListings, tradeHub.outgoingOffers]);

  async function buy(item) {
    if (buyBusy) return;
    setErr("");
    setSuccess("");

    if (!inv) return;

    if (!isConnected || !address) {
      setErr("Please connect wallet to buy items.");
      return;
    }
    if (isEmbedded ? !smartClient : (!walletClient || !publicClient)) {
      setErr("Wallet is not ready.");
      return;
    }
    if (!rewards?.contractAddress || !rewards?.burnAddress) {
      setErr("Token configuration is not loaded.");
      return;
    }
    if (available == null) {
      setErr("Balance not loaded yet.");
      return;
    }
    if (item.price > available) {
      setErr(`Not enough on-chain GCT. Need ${item.price}, available ${available.toFixed(2)}.`);
      return;
    }
    if (isOwned(inv, item.id)) {
      setErr("You already own this item.");
      return;
    }

    setBuyBusy(item.id);
    try {
      const targetChainId = Number(rewards.chainId || sepolia.id);
      if (!isEmbedded && chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      const amountWei = parseUnits(String(item.price), Number(rewards.decimals || 18));
      let burnTxHash;
      if (isEmbedded && smartClient) {
        // Account Kit sendTransaction already waits for UserOp inclusion —
        // the tx is already mined by the time we get the hash back.
        burnTxHash = await smartClient.sendTransaction({
          to: rewards.contractAddress,
          data: encodeFunctionData({
            abi: greenCommuteTokenAbi,
            functionName: "transfer",
            args: [rewards.burnAddress, amountWei],
          }),
          value: 0n,
        });
        // No receipt wait needed — tx is already included
      } else {
        burnTxHash = await walletClient.writeContract({
          account: walletClient.account,
          address: rewards.contractAddress,
          abi: greenCommuteTokenAbi,
          functionName: "transfer",
          args: [rewards.burnAddress, amountWei],
          chain: sepolia,
        });
        // confirmations: 0 = just wait for inclusion, skip extra block
        const burnReceipt = await publicClient.waitForTransactionReceipt({
          hash: burnTxHash,
          confirmations: 0,
        });
        if (burnReceipt.status !== "success") {
          throw new Error("Burn transaction reverted.");
        }
      }

      const result = await fetchJson(`${API}/api/shop/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          itemId: item.id,
          itemName: item.name,
          slotName: item.slot,
          priceTokens: Number(item.price || 0),
          metadata: {
            image: item.image || null,
            characters: item.characters || [],
            tags: item.tags || [],
          },
          txHash: burnTxHash,
          chainId: targetChainId,
        }),
      });

      const next = addOwned(structuredClone(inv), item.id);
      saveInventory(addressKey, next);
      setInv(next);

      // Show success immediately, refresh in background
      setSuccess(
        result?.alreadyOwned
          ? `Already owned: ${item.name}`
          : result?.nft?.tokenId
          ? `Purchased: ${item.name} | NFT #${result.nft.tokenId}`
          : `Purchased: ${item.name}`
      );
      setBuyBusy("");

      // Background refresh — don't await
      Promise.all([loadRewards(address), syncInventoryFromApi(address), loadTradeHub(address)]).catch(() => {});
    } catch (e) {
      console.error("buy failed:", e);
      // "replacement underpriced" means the bundler already has this UserOp in the mempool
      // from an internal retry — the original tx likely went through. Suppress it.
      if (!String(e?.message || e).toLowerCase().includes("replacement underpriced")) {
        setErr(String(e?.message || e));
      }
    } finally {
      setBuyBusy("");
    }
  }

  async function createTradeListing() {
    if (!isConnected || !address) {
      setErr("Connect wallet to create a trade listing.");
      return;
    }
    if (!listingItemId) {
      setErr("Choose one of your NFT items first.");
      return;
    }
    setTradeBusy("listing");
    setErr("");
    setSuccess("");
    try {
      const json = await fetchJson(`${API}/api/trades/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          itemId: listingItemId,
          note: listingNote.trim() || null,
        }),
      });
      setTradeHub({
        openListings: json?.openListings || [],
        myListings: json?.myListings || [],
        incomingOffers: json?.incomingOffers || [],
        outgoingOffers: json?.outgoingOffers || [],
        tradeOperatorAddress: json?.tradeOperatorAddress || null,
        tradeApprovalRequired: Boolean(json?.tradeApprovalRequired),
        viewerTradeApproved: Boolean(json?.viewerTradeApproved),
      });
      setListingItemId("");
      setListingNote("");
      setSuccess("Trade listing created.");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setTradeBusy("");
    }
  }

  async function sendTradeOffer(listingId) {
    if (!isConnected || !address) {
      setErr("Connect wallet to send a trade offer.");
      return;
    }
    const offeredItemId = offerSelections[listingId] || "";
    if (!offeredItemId) {
      setErr("Choose which NFT item you want to offer.");
      return;
    }
    setTradeBusy(`offer:${listingId}`);
    setErr("");
    setSuccess("");
    try {
      const json = await fetchJson(`${API}/api/trades/listings/${listingId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          offeredItemId,
          note: (offerNotes[listingId] || "").trim() || null,
        }),
      });
      setTradeHub({
        openListings: json?.openListings || [],
        myListings: json?.myListings || [],
        incomingOffers: json?.incomingOffers || [],
        outgoingOffers: json?.outgoingOffers || [],
        tradeOperatorAddress: json?.tradeOperatorAddress || null,
        tradeApprovalRequired: Boolean(json?.tradeApprovalRequired),
        viewerTradeApproved: Boolean(json?.viewerTradeApproved),
      });
      setOfferSelections((prev) => ({ ...prev, [listingId]: "" }));
      setOfferNotes((prev) => ({ ...prev, [listingId]: "" }));
      setSuccess("Trade offer sent.");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setTradeBusy("");
    }
  }

  async function actOnTrade(path, successMessage) {
    if (!isConnected || !address) return;
    setTradeBusy(path);
    setErr("");
    setSuccess("");
    try {
      const json = await fetchJson(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });

      // Trade accept can change actual NFT ownership on-chain, so refresh
      // the inventory snapshot as well, not just the trade hub cards.
      await syncInventoryFromApi(address).catch(() => null);

      setTradeHub({
        openListings: json?.openListings || [],
        myListings: json?.myListings || [],
        incomingOffers: json?.incomingOffers || [],
        outgoingOffers: json?.outgoingOffers || [],
      });
      setSuccess(successMessage);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setTradeBusy("");
    }
  }

  async function enableTradeOperator() {
    if (!isConnected || !address) {
      setErr("Connect wallet to enable NFT trading.");
      return;
    }
    if (isEmbedded ? !smartClient : (!walletClient || !publicClient)) {
      setErr("Wallet is not ready.");
      return;
    }
    if (!tradeHub.tradeOperatorAddress) {
      setErr("Trade operator is not configured on the backend.");
      return;
    }

    setTradeBusy("approveTradeOperator");
    setErr("");
    setSuccess("");
    try {
      const targetChainId = Number(tradeHub.cosmeticsChainId || rewards?.chainId || sepolia.id);
      if (!isEmbedded && chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }

      let hash;
      if (isEmbedded && smartClient) {
        hash = await smartClient.sendTransaction({
          to: tradeHub.cosmeticsContractAddress,
          data: encodeFunctionData({
            abi: greenCommuteCosmeticsAbi,
            functionName: "setApprovalForAll",
            args: [tradeHub.tradeOperatorAddress, true],
          }),
          value: 0n,
        });
      } else {
        hash = await walletClient.writeContract({
          account: walletClient.account,
          address: tradeHub.cosmeticsContractAddress,
          abi: greenCommuteCosmeticsAbi,
          functionName: "setApprovalForAll",
          args: [tradeHub.tradeOperatorAddress, true],
          chain: sepolia,
        });
      }
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        throw new Error("Approval transaction reverted.");
      }
      await loadTradeHub(address);
      setSuccess("NFT trade approval enabled.");
    } catch (e) {
      if (!String(e?.message || e).toLowerCase().includes("replacement underpriced")) {
        setErr(String(e?.message || e));
      }
    } finally {
      setTradeBusy("");
    }
  }

  const walletLabel = mounted
    ? isConnected && address
      ? address
      : "Not connected (guest inventory)"
    : "Loading wallet...";

  return (
    <div className="shell">
      <Nav />
      <div className="topbar">
        <div className="title">
          <h1 className="h1">Shop</h1>
          <p className="subtitle">Buy cosmetics with your rewards. Purchases are stored in MySQL via API.</p>
        </div>
      </div>

      {err && <div className="error">Error: {err}</div>}
      {success && (
        <div
          style={{
            border: "1px solid rgba(52,211,153,.25)",
            background: "rgba(52,211,153,.08)",
            color: "rgba(255,255,255,.92)",
            borderRadius: 14,
            padding: "12px 14px",
            marginBottom: 14,
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <button
          type="button"
          className="pill"
          onClick={() => setActiveTab("shop")}
          style={{
            opacity: activeTab === "shop" ? 1 : 0.78,
            border: activeTab === "shop" ? "1px solid rgba(34,211,238,.9)" : undefined,
          }}
        >
          Shop
        </button>
        <button
          type="button"
          className="pill"
          onClick={() => setActiveTab("trade")}
          style={{
            opacity: activeTab === "trade" ? 1 : 0.78,
            border: activeTab === "trade" ? "1px solid rgba(34,211,238,.9)" : undefined,
          }}
        >
          Trade
        </button>
      </div>

      {activeTab === "shop" ? (
      <div className="grid">
        <div className="shop-stat-strip" style={{ gridColumn: "span 12" }}>
          <div className="shop-stat-strip-inner">
            <div className="shop-stat-pill">
              <span className="shop-stat-label">Spendable</span>
              <span className="shop-stat-val">{mounted && isConnected ? (available ?? "...") : "–"} <span className="shop-stat-unit">GCT</span></span>
            </div>
            <div className="shop-stat-divider" />
            <div className="shop-stat-pill">
              <span className="shop-stat-label">Owned</span>
              <span className="shop-stat-val">{inv ? inv.owned.length : "..."} <span className="shop-stat-unit">items</span></span>
            </div>
            <div className="shop-stat-divider" />
            <div className="shop-stat-pill">
              <span className="shop-stat-label">Avatar</span>
              <span className="shop-stat-val mono" style={{ fontSize: 13 }}>{activeCharacter}</span>
            </div>
          </div>
          {mounted && isConnected && available === 0 && rewards?.claimedTokens > 0 && (() => {
            const status = rewards?.onChainStatus;
            let msg = null;
            if (status === "rpc_unreachable") msg = "Az RPC nem elérhető – a lánc fut?";
            else if (status === "contract_not_deployed") msg = "A GCT contract nincs deployolva ezen a láncon. Indítsd újra a Hardhat-et, deploy-olj, és igényeld újra a tokened.";
            else if (status === "ok" || status === "empty_response" || status === "call_failed") msg = "A láncon 0 GCT van, de a DB szerint már claimeltél. Valószínűleg újraindult a Hardhat-lánc – töröld a DB adatot (/api/dev/chain-data) és igényeld újra.";
            if (!msg) return null;
            return (
              <div style={{ fontSize: 11, color: "rgba(251,191,36,.9)", marginTop: 6, lineHeight: 1.4, paddingBottom: 2 }}>
                ⚠ {msg}
              </div>
            );
          })()}
        </div>

        {AVATAR_SHOP_SLOTS.map((slot) => (
          <div key={slot} className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent cyan" />
            <div className="card-inner">
              <div className="section-title" style={{ textTransform: "capitalize" }}>
                <span style={{ marginRight: 6 }}>{AVATAR_SLOT_ICONS[slot] || "🎮"}</span>
                {AVATAR_SLOT_LABELS[slot] || slot} <span className="hint">({AVATAR_SLOT_HINTS[slot] || "cosmetics"})</span>
              </div>

              <div className="shop-grid">
                {(grouped[slot] || []).map((it) => {
                  const owned = inv ? isOwned(inv, it.id) : false;
                  const characterLocked = false;
                  const cosmeticToken = getCosmeticToken(it.id);

                  return (
                    <div key={it.id} className="shop-item">
                      <div className="shop-img" style={{ position: "relative" }}>
                        <img
                          src={it.image}
                          alt={it.name}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        {owned ? (
                          <div className="shop-owned-badge">✓</div>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 900 }}>{it.name}</div>
                          {cosmeticToken?.tokenId ? (
                            <div className="small">
                              NFT: <span className="mono">#{cosmeticToken.tokenId}</span>
                            </div>
                          ) : null}
                          <div className="small">
                            {getItemRarity(it)} · {getItemTheme(it)}
                          </div>

                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 900 }}>{it.price} GCT</div>
                          <div className="small">
                            {owned ? "owned" : "not owned"}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => buy(it)}
                        disabled={!inv || owned || !!buyBusy}
                        className={owned ? "shop-buy-btn shop-buy-btn--owned" : "shop-buy-btn"}
                      >
                        {buyBusy === it.id ? "Buying…" : owned ? "✓ Already owned" : "Buy"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {(grouped[slot] || []).length === 0 ? (
                <div className="small" style={{ marginTop: 10 }}>
                  No assets are wired for this slot yet.
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      ) : (
        <div className="grid">
          <div className="trade-stat-strip" style={{ gridColumn: "span 12" }}>
            <div className="trade-stat-pill">
              <span className="shop-stat-label">My listings</span>
              <span className="shop-stat-val">{activeMyListings.length} <span className="shop-stat-unit">open</span></span>
            </div>
            <div className="shop-stat-divider" />
            <div className="trade-stat-pill">
              <span className="shop-stat-label">Market</span>
              <span className="shop-stat-val">{tradeHub.openListings.length} <span className="shop-stat-unit">listings</span></span>
            </div>
            <div className="shop-stat-divider" />
            <div className="trade-stat-pill">
              <span className="shop-stat-label">Pending offers</span>
              <span className="shop-stat-val trade-stat-offers">{tradeHub.incomingOffers?.length || 0} <span className="shop-stat-unit">in</span> · {activeOutgoingOffers.length} <span className="shop-stat-unit">out</span></span>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent cyan" />
            <div className="card-inner">
              <div className="section-title">🔄 Trade Hub <span className="hint">NFT-for-NFT swaps</span></div>
              <div className="small" style={{ marginTop: 8 }}>
                Put your NFT items up for trade, then other users can send swap offers. When both sides have enabled the trade operator, accepting an offer swaps the two ERC-1155 items on-chain.
              </div>
              {isConnected && tradeHub.tradeApprovalRequired ? (
                <div className={`trade-approval-banner ${tradeHub.viewerTradeApproved ? "trade-approval-banner--ok" : ""}`}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 18 }}>{tradeHub.viewerTradeApproved ? "✅" : "⚠️"}</span>
                    <div className="small">
                      {tradeHub.viewerTradeApproved
                        ? "Trade approval is enabled for this wallet."
                        : "Enable the trade operator once so accepted offers can actually swap your NFT items."}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pill"
                    onClick={enableTradeOperator}
                    disabled={tradeBusy === "approveTradeOperator" || tradeHub.viewerTradeApproved}
                  >
                    {tradeHub.viewerTradeApproved
                      ? "Trade enabled"
                      : tradeBusy === "approveTradeOperator"
                      ? "Enabling..."
                      : "Enable NFT trades"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent green" />
            <div className="card-inner">
              <div className="section-title">✍️ Create Trade Listing</div>
              {!isConnected ? (
                <div className="small" style={{ marginTop: 10 }}>Connect wallet to open a trade listing.</div>
              ) : ownedOnChainItems.length === 0 ? (
                <div className="small" style={{ marginTop: 10 }}>
                  You do not have any active NFT cosmetics yet. Buy a new item after the cosmetics contract is configured, then it will appear here.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <div className="small">Choose your NFT item to list</div>
                  <div style={tradePickerGrid}>
                    {ownedOnChainItems.map((item) => {
                      const selected = listingItemId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setListingItemId(item.id)}
                          className={selected ? "trade-picker-card trade-picker-card--selected" : "trade-picker-card"}
                        >
                          <div style={tradeThumbWrap}>
                            <img
                              src={item.image}
                              alt={item.name}
                              style={tradeThumb}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </div>
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontWeight: 900 }}>{item.name}</div>
                            <div className="small">
                              {item.slot} #{getCosmeticToken(item.id)?.tokenId}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <input
                    value={listingNote}
                    onChange={(e) => setListingNote(e.target.value)}
                    placeholder="Optional note, for example: looking for hats or cute accessories"
                    style={tradeInput}
                  />
                  <div>
                    <button
                      type="button"
                      className="pill"
                      onClick={createTradeListing}
                      disabled={tradeBusy === "listing" || !listingItemId}
                    >
                      {tradeBusy === "listing" ? "Creating..." : "Create listing"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent amber" />
            <div className="card-inner">
              <div className="section-title">📋 Open Trade Listings</div>
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                {tradeHub.openListings.length === 0 ? (
                  <div className="small">No trade listings are open yet.</div>
                ) : (
                  tradeHub.openListings.map((listing) => (
                    <div key={listing.id} className="trade-card">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          {listing.item?.image ? (
                            <div style={tradeThumbWrap}>
                              <img
                                src={listing.item.image}
                                alt={listing.item?.name || listing.itemId}
                                style={tradeThumb}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          ) : null}
                          <div>
                            <div style={{ fontWeight: 900 }}>
                              {listing.item?.name || listing.itemId} <span className="small mono">#{getCosmeticToken(listing.itemId)?.tokenId || "-"}</span>
                            </div>
                            <div className="small">
                              By <span className="mono">{listing.owner?.customDisplayName || shortAddr(listing.ownerWallet)}</span>
                            </div>
                            {listing.note ? <div className="small" style={{ marginTop: 6, fontStyle: "italic", opacity: 0.8 }}>{listing.note}</div> : null}
                          </div>
                        </div>
                        <div className="badge">{listing.item?.slot || "item"}</div>
                      </div>

                      {isConnected ? (
                        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                          <div className="trade-swap-row">
                            <div className="small">Offer one of your NFT items</div>
                            <div className="trade-swap-arrow">⇄</div>
                          </div>
                          <div style={tradePickerGrid}>
                            {ownedOnChainItems
                              .filter((item) => item.id !== listing.itemId)
                              .map((item) => {
                                const selected = (offerSelections[listing.id] || "") === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() =>
                                      setOfferSelections((prev) => ({ ...prev, [listing.id]: item.id }))
                                    }
                                    className={selected ? "trade-picker-card trade-picker-card--selected" : "trade-picker-card"}
                                  >
                                    <div style={tradeThumbWrap}>
                                      <img
                                        src={item.image}
                                        alt={item.name}
                                        style={tradeThumb}
                                        onError={(e) => {
                                          e.currentTarget.style.display = "none";
                                        }}
                                      />
                                    </div>
                                    <div style={{ textAlign: "left" }}>
                                      <div style={{ fontWeight: 900 }}>{item.name}</div>
                                      <div className="small">
                                        {item.slot} #{getCosmeticToken(item.id)?.tokenId}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                          <input
                            value={offerNotes[listing.id] || ""}
                            onChange={(e) => setOfferNotes((prev) => ({ ...prev, [listing.id]: e.target.value }))}
                            placeholder="Optional trade note"
                            style={tradeInput}
                          />
                          <div>
                            <button
                              type="button"
                              className="pill"
                              onClick={() => sendTradeOffer(listing.id)}
                              disabled={tradeBusy === `offer:${listing.id}` || !offerSelections[listing.id]}
                            >
                              {tradeBusy === `offer:${listing.id}` ? "Sending..." : "Send offer"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent purple" />
            <div className="card-inner">
              <div className="section-title">📬 My Listings &amp; Offers</div>
              <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                {activeMyListings.map((listing) => (
                  <div key={listing.id} className="trade-card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        {listing.item?.image ? (
                          <div style={tradeThumbWrap}>
                            <img
                              src={listing.item.image}
                              alt={listing.item?.name || listing.itemId}
                              style={tradeThumb}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </div>
                        ) : null}
                        <div>
                          <div style={{ fontWeight: 900 }}>{listing.item?.name || listing.itemId}</div>
                          <div className="small">{listing.note || "No listing note."}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <div className="badge trade-status-badge" style={{ ...statusBadge, ...getTradeStatusVisual(listing.status).style }}>
                          {getTradeStatusVisual(listing.status).icon} {formatTradeStatus(listing.status)}
                        </div>
                        {listing.status === "open" ? (
                          <button
                            type="button"
                            className="pill"
                            onClick={() => actOnTrade(`/api/trades/listings/${listing.id}/cancel`, "Trade listing cancelled.")}
                            disabled={tradeBusy === `/api/trades/listings/${listing.id}/cancel`}
                          >
                            Cancel listing
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {listing.offers.length === 0 ? (
                        <div className="small">No offers yet.</div>
                      ) : (
                        listing.offers.map((offer) => (
                          <div key={offer.id} className="trade-offer-card">
                            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                              {offer.offeredItem?.image ? (
                                <div style={tradeThumbWrap}>
                                  <img
                                    src={offer.offeredItem.image}
                                    alt={offer.offeredItem?.name || offer.offeredItemId}
                                    style={tradeThumb}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                </div>
                              ) : null}
                              <div>
                                <div style={{ fontWeight: 800 }}>
                                  {offer.offeredItem?.name || offer.offeredItemId}
                                  <span className="trade-offer-from"> from {offer.offerer?.customDisplayName || shortAddr(offer.offererWallet)}</span>
                                </div>
                                <div className="small">{offer.note || "No note."}</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <div className="badge trade-status-badge" style={{ ...statusBadge, ...getTradeStatusVisual(offer.status).style }}>
                                {getTradeStatusVisual(offer.status).icon} {formatTradeStatus(offer.status)}
                              </div>
                              {offer.status === "pending" ? (
                                <>
                                  <button
                                    type="button"
                                    className="pill"
                                    onClick={() => actOnTrade(`/api/trades/offers/${offer.id}/accept`, "Trade offer accepted.")}
                                    disabled={tradeBusy === `/api/trades/offers/${offer.id}/accept`}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="pill"
                                    onClick={() => actOnTrade(`/api/trades/offers/${offer.id}/reject`, "Trade offer rejected.")}
                                    disabled={tradeBusy === `/api/trades/offers/${offer.id}/reject`}
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}

                {activeMyListings.length === 0 ? <div className="small">You do not have any active listings.</div> : null}

                {activeOutgoingOffers.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="section-title" style={{ fontSize: 18 }}>↗ Outgoing Offers</div>
                    {activeOutgoingOffers.map((offer) => (
                      <div key={offer.id} className="trade-offer-card">
                        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          {offer.offeredItem?.image ? (
                            <div style={tradeThumbWrap}>
                              <img
                                src={offer.offeredItem.image}
                                alt={offer.offeredItem?.name || offer.offeredItemId}
                                style={tradeThumb}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </div>
                          ) : null}
                          <div>
                            <div style={{ fontWeight: 800 }}>
                              {offer.offeredItem?.name || offer.offeredItemId}
                              <span className="trade-arrow"> → </span>
                              {offer.listing?.item?.name || offer.listingId}
                            </div>
                            <div className="small">{offer.note || "No note."}</div>
                          </div>
                        </div>
                        <div className="badge trade-status-badge" style={{ ...statusBadge, ...getTradeStatusVisual(offer.status).style }}>
                          {getTradeStatusVisual(offer.status).icon} {formatTradeStatus(offer.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="card" style={{ gridColumn: "span 12" }}>
            <div className="accent cyan" />
            <div className="card-inner">
              <div className="section-title">🕐 Trade History</div>
              <div className="small" style={{ marginTop: 8 }}>
                Completed, rejected and cancelled trade events.
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {tradeHistory.length === 0 ? (
                  <div className="small">No finished trade activity yet.</div>
                ) : (
                  tradeHistory.map((entry) => (
                    <div key={entry.id} className="trade-offer-card">
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        {entry.image ? (
                          <div style={tradeThumbWrap}>
                            <img
                              src={entry.image}
                              alt={entry.title}
                              style={tradeThumb}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </div>
                        ) : null}
                          <div>
                            <div style={{ fontWeight: 800 }}>{entry.title}</div>
                            <div className="small">{entry.subtitle}</div>
                            {entry.updatedAt ? (
                            <div className="small" style={{ marginTop: 4 }}>
                              {formatTradeDate(entry.updatedAt)}
                            </div>
                          ) : null}
                          </div>
                        </div>
                      <div
                        className="badge trade-status-badge"
                        style={{
                          ...statusBadge,
                          ...getTradeStatusVisual(entry.status).style,
                        }}
                      >
                        {getTradeStatusVisual(entry.status).icon} {formatTradeStatus(entry.status)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const tradeInput = {
  minWidth: 240,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(255,255,255,.06)",
  color: "rgba(255,255,255,.96)",
  padding: "10px 12px",
  outline: "none",
};

const tradeCard = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.03)",
  padding: 14,
};

const tradeOfferCard = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,.08)",
  background: "rgba(255,255,255,.025)",
  padding: 12,
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
};

const tradePickerGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const tradeSelectableCard = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.035)",
  padding: 12,
  color: "rgba(255,255,255,.96)",
  cursor: "pointer",
};

const tradeThumbWrap = {
  width: 72,
  height: 72,
  flex: "0 0 72px",
  borderRadius: 14,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.04)",
  display: "grid",
  placeItems: "center",
};

const tradeThumb = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const statusBadge = {
  minWidth: 72,
  textAlign: "center",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  padding: "6px 12px",
  borderRadius: 999,
  lineHeight: 1.1,
};
