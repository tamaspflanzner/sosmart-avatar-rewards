import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { appChain, appRpcUrl } from "./chainConfig";

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  ssr: true,
  transports: { [appChain.id]: http(appRpcUrl) },
});
