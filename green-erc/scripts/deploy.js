const hre = require("hardhat");
require("dotenv").config();
const { buildCosmeticCatalog } = require("./cosmeticCatalog");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;
  const defaultCosmeticsUri =
    process.env.COSMETICS_BASE_URI || "greencommute://cosmetics/{id}";

  console.log("Deploying with:", deployer.address);
  console.log("Oracle address:", oracleAddress);
  console.log("Network:", hre.network.name);

  const Token = await hre.ethers.getContractFactory("GreenCommuteToken");
  const token = await Token.deploy(oracleAddress);

  await token.deployed();

  const Cosmetics = await hre.ethers.getContractFactory("GreenCommuteCosmetics");
  const cosmetics = await Cosmetics.deploy(defaultCosmeticsUri, deployer.address);

  await cosmetics.deployed();

  if (oracleAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    const allowOracleMintTx = await cosmetics.setMinter(oracleAddress, true);
    await allowOracleMintTx.wait();
  }

  const cosmeticCatalog = buildCosmeticCatalog();
  const tokenIds = cosmeticCatalog.map((entry) => entry.tokenId);
  const tokenUris = cosmeticCatalog.map((entry) => entry.metadataUri);

  const chunkSize = 25;
  for (let index = 0; index < tokenIds.length; index += chunkSize) {
    const tokenIdChunk = tokenIds.slice(index, index + chunkSize);
    const tokenUriChunk = tokenUris.slice(index, index + chunkSize);
    const tx = await cosmetics.setTokenUris(tokenIdChunk, tokenUriChunk);
    await tx.wait();
  }

  console.log("GreenCommuteToken deployed to:", token.address);
  console.log("GreenCommuteCosmetics deployed to:", cosmetics.address);
  console.log("Chain ID:", hre.network.config.chainId);
  console.log("Cosmetic token count:", cosmeticCatalog.length);

  console.log("\nPut these into green-api/.env:");
  console.log(`GCT_CONTRACT_ADDRESS=${token.address}`);
  console.log(`GCT_CHAIN_ID=${hre.network.config.chainId || 31337}`);
  console.log(`GCT_ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`COSMETICS_CONTRACT_ADDRESS=${cosmetics.address}`);
  console.log(`COSMETICS_BASE_URI=${defaultCosmeticsUri}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
