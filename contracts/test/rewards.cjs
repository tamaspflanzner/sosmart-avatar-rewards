const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
const { buildCosmeticCatalog } = require("../scripts/cosmeticCatalog");

async function fixture() {
  const [oracle, rider, other] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("GreenCommuteToken")).deploy(oracle.address);
  await token.deployed();
  const network = await ethers.provider.getNetwork();
  const expiry = (await ethers.provider.getBlock("latest")).timestamp + 3600;
  const claim = { user: rider.address, amount: ethers.utils.parseEther("5"), nonce: 1, expiry };
  const domain = { name: "GreenCommuteToken", version: "1", chainId: network.chainId, verifyingContract: token.address };
  const types = { Claim: [
    { name: "user", type: "address" }, { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" },
  ] };
  const signature = await oracle._signTypedData(domain, types, claim);
  const args = [claim.user, claim.amount, claim.nonce, claim.expiry, signature];
  return { oracle, rider, other, token, claim, domain, types, args };
}

describe("GCT reward claims", function () {
  it("mints signed rewards once and rejects a replay", async function () {
    const { token, rider, args } = await fixture();
    await (await token.connect(rider).claimReward(...args)).wait();
    assert.equal((await token.balanceOf(rider.address)).toString(), ethers.utils.parseEther("5").toString());
    await assert.rejects(token.connect(rider).claimReward(...args), /NonceAlreadyUsed/);
  });

  it("rejects claims submitted by a different rider or signed by a different oracle", async function () {
    const { token, rider, other, claim, domain, types, args } = await fixture();
    await assert.rejects(token.connect(other).claimReward(...args), /InvalidCaller/);
    const forged = await other._signTypedData(domain, types, claim);
    await assert.rejects(token.connect(rider).claimReward(...args.slice(0, 4), forged), /InvalidSignature/);
  });

  it("rejects an expired reward", async function () {
    const { oracle, rider, token, claim, domain, types } = await fixture();
    claim.expiry = 1;
    const signature = await oracle._signTypedData(domain, types, claim);
    await assert.rejects(token.connect(rider).claimReward(claim.user, claim.amount, claim.nonce, claim.expiry, signature), /SignatureExpired/);
  });
});

describe("Avatar cosmetics", function () {
  it("loads the web catalog and permits only authorized minting", async function () {
    const [owner, rider, recipient] = await ethers.getSigners();
    const catalog = buildCosmeticCatalog();
    assert.ok(catalog.length > 0);
    assert.equal(new Set(catalog.map((item) => item.tokenId)).size, catalog.length);
    const cosmetics = await (await ethers.getContractFactory("GreenCommuteCosmetics")).deploy("greencommute://cosmetics/{id}", owner.address);
    await cosmetics.deployed();
    const item = catalog[0];
    await assert.rejects(cosmetics.connect(rider).mintTo(rider.address, item.tokenId, 1, "0x"), /UnauthorizedMinter/);
    await (await cosmetics.mintTo(rider.address, item.tokenId, 1, "0x")).wait();
    assert.equal((await cosmetics.balanceOf(rider.address, item.tokenId)).toString(), "1");
    await (await cosmetics.connect(rider).safeTransferFrom(rider.address, recipient.address, item.tokenId, 1, "0x")).wait();
    assert.equal((await cosmetics.balanceOf(recipient.address, item.tokenId)).toString(), "1");
  });
});
