"use client";

import { createContext, useContext } from "react";
import { useAccount as useWagmiAccount } from "wagmi";
import {
  useAccount as useAlchemyAccount,
  useAuthModal,
  useLogout,
  useSignerStatus,
  useSmartAccountClient,
  useUser,
} from "@account-kit/react";
import { useHydrated } from "./useHydrated";

export const AA_ENABLED = ["1", "true", "yes"].includes(
  String(process.env.NEXT_PUBLIC_AA_ENABLED || "").toLowerCase()
);
const noAction = () => {};
const defaultEmbedded = {
  address: null,
  isConnected: false,
  smartClient: null,
  isLoadingWallet: false,
  embeddedEmail: null,
  openEmbeddedAuthModal: noAction,
  logoutEmbedded: async () => {},
};
const EmbeddedWalletContext = createContext(defaultEmbedded);

// Only mounted inside AlchemyAccountProvider. Every Account Kit hook is called
// unconditionally, while external-wallet-only mode never requires its provider.
export function EmbeddedWalletProvider({ children }) {
  const authModal = useAuthModal();
  const logoutApi = useLogout();
  const signerStatus = useSignerStatus();
  const user = useUser();
  const account = useAlchemyAccount({ type: "LightAccount", skipCreate: !signerStatus.isConnected });
  const { client } = useSmartAccountClient({ type: "LightAccount" });
  const address = signerStatus.isConnected ? account?.address ?? null : null;
  return (
    <EmbeddedWalletContext.Provider value={{
      address,
      isConnected: Boolean(address),
      smartClient: signerStatus.isConnected ? client ?? null : null,
      isLoadingWallet: Boolean(signerStatus.isConnected && account?.isLoadingAccount && !address),
      embeddedEmail: user?.email ?? null,
      openEmbeddedAuthModal: authModal.openAuthModal,
      logoutEmbedded: logoutApi.logout,
    }}>
      {children}
    </EmbeddedWalletContext.Provider>
  );
}

export function useWallet() {
  const mounted = useHydrated();
  const wagmi = useWagmiAccount();
  const embedded = useContext(EmbeddedWalletContext);
  const externalConnected = mounted && wagmi.isConnected && Boolean(wagmi.address);
  const isEmbedded = mounted && !externalConnected && AA_ENABLED;
  return {
    address: externalConnected ? wagmi.address : isEmbedded ? embedded.address : undefined,
    isConnected: externalConnected || (isEmbedded && embedded.isConnected),
    isEmbedded: Boolean(isEmbedded && (embedded.isConnected || embedded.isLoadingWallet)),
    smartClient: isEmbedded ? embedded.smartClient : null,
    smartAddress: isEmbedded ? embedded.address : null,
    isLoadingWallet: !mounted || (isEmbedded && embedded.isLoadingWallet),
    embeddedEmail: isEmbedded ? embedded.embeddedEmail : null,
    openEmbeddedAuthModal: embedded.openEmbeddedAuthModal,
    logoutEmbedded: embedded.logoutEmbedded,
    aaEnabled: AA_ENABLED,
  };
}
