"use client";

import { useEffect, useMemo, useState } from "react";
import { WagmiProvider } from "wagmi";
import { AlchemyAccountProvider } from "@account-kit/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAccountKitQueryClient, createAccountKitRuntimeConfig } from "../lib/accountKitConfig";
import { wagmiConfig } from "../lib/wagmiConfig";

export default function Providers({ children }) {
  const [mounted, setMounted] = useState(false);
  const [queryClient] = useState(() => createAccountKitQueryClient());
  const aaEnabled = useMemo(() => {
    const flag = String(process.env.NEXT_PUBLIC_AA_ENABLED || "").toLowerCase();
    return flag === "1" || flag === "true" || flag === "yes";
  }, []);
  const accountKitConfig = useMemo(() => {
    if (!mounted || !aaEnabled) return null;
    return createAccountKitRuntimeConfig();
  }, [mounted, aaEnabled]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (aaEnabled && (!mounted || !accountKitConfig)) {
    return null;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {aaEnabled && accountKitConfig ? (
          <AlchemyAccountProvider config={accountKitConfig} queryClient={queryClient}>
            {children}
          </AlchemyAccountProvider>
        ) : (
          children
        )}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
