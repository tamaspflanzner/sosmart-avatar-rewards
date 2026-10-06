require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

const networks = {
  hardhat: {
    chainId: 31337,
  },
  localhost: {
    url: process.env.LOCALHOST_RPC_URL || "http://127.0.0.1:8545",
    chainId: 31337,
  },
  sepolia: {
    url: process.env.SEPOLIA_RPC_URL || "",
    accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    chainId: 11155111,
  },
};

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks,
};