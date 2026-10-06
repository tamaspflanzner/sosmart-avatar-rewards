import { hardhat, sepolia } from "wagmi/chains";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || sepolia.id);
export const appChain = chainId === hardhat.id ? hardhat : sepolia;
if (![hardhat.id, sepolia.id].includes(chainId)) {
  throw new Error("NEXT_PUBLIC_CHAIN_ID must be 31337 (local) or 11155111 (Sepolia).");
}
const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
export const appRpcUrl = process.env.NEXT_PUBLIC_RPC_URL || (
  appChain.id === hardhat.id ? "http://127.0.0.1:8545" :
  apiKey ? `https://eth-sepolia.g.alchemy.com/v2/${apiKey}` : undefined
);
