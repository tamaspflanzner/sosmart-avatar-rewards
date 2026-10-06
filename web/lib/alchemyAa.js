"use client";

import { WalletClientSigner } from "@aa-sdk/core";
import {
  alchemy,
  base as alchemyBase,
  baseSepolia as alchemyBaseSepolia,
  mainnet as alchemyMainnet,
  sepolia as alchemySepolia,
} from "@account-kit/infra";
import { createLightAccountClient } from "@account-kit/smart-contracts";
import { createWalletClient, custom } from "viem";

const SUPPORTED_CHAINS = {
  1: alchemyMainnet,
  8453: alchemyBase,
  84532: alchemyBaseSepolia,
  11155111: alchemySepolia,
};

export function getAlchemyAaRuntime() {
  const apiKey = String(process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "").trim();
  const policyId = String(process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID || "").trim();
  const configuredChainId = Number(process.env.NEXT_PUBLIC_ALCHEMY_CHAIN_ID || 0);
  const chain = SUPPORTED_CHAINS[configuredChainId] || null;
  const enabledFlag = String(process.env.NEXT_PUBLIC_AA_ENABLED || "").toLowerCase();
  const enabled = enabledFlag === "1" || enabledFlag === "true" || enabledFlag === "yes";

  return {
    apiKey,
    policyId,
    configuredChainId,
    chain,
    enabled,
    ready: Boolean(enabled && apiKey && policyId && chain),
  };
}

export function isAlchemyAaActiveForChain(chainId) {
  const runtime = getAlchemyAaRuntime();
  return runtime.ready && Number(chainId) === Number(runtime.configuredChainId);
}

export function getAlchemyAaUnavailableReason(chainId) {
  const runtime = getAlchemyAaRuntime();
  if (!runtime.enabled) return "AA disabled by env flag.";
  if (!runtime.apiKey) return "Missing NEXT_PUBLIC_ALCHEMY_API_KEY.";
  if (!runtime.policyId) return "Missing NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID.";
  if (!runtime.chain) return "Unsupported NEXT_PUBLIC_ALCHEMY_CHAIN_ID.";
  if (Number(chainId) !== Number(runtime.configuredChainId)) {
    return `AA configured for chain ${runtime.configuredChainId}, current claim needs chain ${chainId}.`;
  }
  if (typeof window === "undefined" || !window.ethereum) {
    return "Injected wallet is not available in the browser.";
  }
  return "";
}

function createInjectedWalletClient({ address, chain }) {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("Injected wallet is not available.");
  }

  return createWalletClient({
    account: address,
    chain,
    transport: custom(window.ethereum),
  });
}

export async function createAlchemyClaimClient({ address }) {
  const runtime = getAlchemyAaRuntime();
  if (!runtime.ready || !runtime.chain) {
    throw new Error("Alchemy AA is not configured.");
  }

  const ownerWalletClient = createInjectedWalletClient({
    address,
    chain: runtime.chain,
  });

  const signer = new WalletClientSigner(ownerWalletClient, "wallet");

  return createLightAccountClient({
    transport: alchemy({ apiKey: runtime.apiKey }),
    chain: runtime.chain,
    signer,
    policyId: runtime.policyId,
  });
}
