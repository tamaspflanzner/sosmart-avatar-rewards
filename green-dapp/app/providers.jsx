"use client";

import { useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { AlchemyAccountProvider } from "@account-kit/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAccountKitQueryClient, createAccountKitRuntimeConfig } from "../lib/accountKitConfig";
import { wagmiConfig } from "../lib/wagmiConfig";

import { AA_ENABLED, EmbeddedWalletProvider } from "../lib/useWallet";
import { useHydrated } from "../lib/useHydrated";

export default function Providers({ children }) {
  const mounted = useHydrated();
  const [queryClient] = useState(() => createAccountKitQueryClient());
  const aaEnabled = AA_ENABLED;
  const accountKitConfig = useMemo(() => {
    if (!mounted || !aaEnabled) return null;
    return createAccountKitRuntimeConfig();
  }, [mounted, aaEnabled]);

  if (aaEnabled && (!mounted || !accountKitConfig)) {
    return null;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {aaEnabled && accountKitConfig ? (
          <AlchemyAccountProvider config={accountKitConfig} queryClient={queryClient}>
            <EmbeddedWalletProvider>{children}</EmbeddedWalletProvider>
          </AlchemyAccountProvider>
        ) : (
          children
        )}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
