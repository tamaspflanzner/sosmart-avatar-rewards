"use client";

import { useEffect, useState } from "react";
import { useAccount as useWagmiAccount } from "wagmi";
import {
  useAccount as useAlchemyAccount,
  useAuthModal,
  useLogout,
  useSignerStatus,
  useSmartAccountClient,
  useUser,
} from "@account-kit/react";

const AA_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.NEXT_PUBLIC_AA_ENABLED || "").toLowerCase()
);

/**
 * Unified wallet hook.
 * - EOA / injected wallet comes from wagmi
 * - Embedded / Account Kit wallet comes from Account Kit hooks
 */
export function useWallet() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const wagmi = useWagmiAccount();

  const authModal = AA_ENABLED ? useAuthModal() : { openAuthModal: () => {} };
  const logoutApi = AA_ENABLED ? useLogout() : { logout: async () => {} };
  const signerStatus = AA_ENABLED
    ? useSignerStatus()
    : { isConnected: false, isAuthenticating: false, isInitializing: false };
  const user = AA_ENABLED ? useUser() : null;
  const alchemyAccount = AA_ENABLED
    ? useAlchemyAccount({ type: "LightAccount", skipCreate: !signerStatus.isConnected })
    : { address: undefined, isLoadingAccount: false };
  const { client: smartWalletClient } = AA_ENABLED ? useSmartAccountClient({ type: "LightAccount" }) : { client: null };

  if (!mounted) {
    return {
      address: undefined,
      isConnected: false,
      isEmbedded: false,
      smartClient: null,
      smartAddress: null,
      isLoadingWallet: true,
      embeddedEmail: null,
      openEmbeddedAuthModal: () => {},
      logoutEmbedded: async () => {},
      aaEnabled: AA_ENABLED,
    };
  }

  if (wagmi.isConnected && wagmi.address) {
    return {
      address: wagmi.address,
      isConnected: true,
      isEmbedded: false,
      smartClient: null,
      smartAddress: null,
      isLoadingWallet: false,
      embeddedEmail: null,
      openEmbeddedAuthModal: authModal.openAuthModal,
      logoutEmbedded: logoutApi.logout,
      aaEnabled: AA_ENABLED,
    };
  }

  if (AA_ENABLED && signerStatus.isConnected) {
    const smartAddress = alchemyAccount?.address ?? null;
    return {
      address: smartAddress,
      isConnected: Boolean(smartAddress),
      isEmbedded: true,
      smartClient: smartWalletClient ?? null,
      smartAddress,
      isLoadingWallet: Boolean(alchemyAccount?.isLoadingAccount && !smartAddress),
      embeddedEmail: user?.email ?? null,
      openEmbeddedAuthModal: authModal.openAuthModal,
      logoutEmbedded: logoutApi.logout,
      aaEnabled: AA_ENABLED,
    };
  }

  return {
    address: undefined,
    isConnected: false,
    isEmbedded: false,
    smartClient: null,
    smartAddress: null,
    isLoadingWallet: false,
    embeddedEmail: null,
    openEmbeddedAuthModal: authModal.openAuthModal,
    logoutEmbedded: logoutApi.logout,
    aaEnabled: AA_ENABLED,
  };
}
