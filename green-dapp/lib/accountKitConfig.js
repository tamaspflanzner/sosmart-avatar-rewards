import { createConfig } from "@account-kit/react";
import { alchemy, sepolia } from "@account-kit/infra";
import { appChain } from "./chainConfig";
import { QueryClient } from "@tanstack/react-query";

export function createAccountKitQueryClient() {
  return new QueryClient();
}

export function createAccountKitRuntimeConfig() {
  if (appChain.id !== sepolia.id) {
    throw new Error("Embedded accounts require Sepolia. Set NEXT_PUBLIC_AA_ENABLED=false for local wallets.");
  }
  const config = {
    transport: alchemy({
      apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
    }),
    chain: sepolia,
    enablePopupOauth: true,
  };
  const policyId = process.env.NEXT_PUBLIC_ALCHEMY_GAS_POLICY_ID;
  if (policyId) config.policyId = policyId;
  return createConfig(
    config,
    {
      auth: {
        sections: [
          [
            { type: "passkey" },
            { type: "social", authProviderId: "google", mode: "popup" },
          ],
          [{ type: "external_wallets", walletConnect: false }],
        ],
        addPasskeyOnSignup: false,
      },
    }
  );
}
