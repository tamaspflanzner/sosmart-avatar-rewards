const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright");
const mysql = require("../api/node_modules/mysql2/promise");
const { ethers } = require("../api/node_modules/ethers");

const root = path.join(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const apiUrl = "http://127.0.0.1:14100";
const rpcUrl = "http://127.0.0.1:18545";
const webUrl = "http://127.0.0.1:13000";
const simulatorUrl = "http://127.0.0.1:13002";

// Real local chain and MySQL, with an injected EIP-1193 test wallet. No external
// wallet extension, cloud account, live network, or funded real account is used.
test("journey -> browser wallet -> GCT claim -> cosmetic purchase -> avatar inventory", { timeout: 600000 }, async (t) => {
  const children = [];
  const results = path.join(root, "test-results");
  fs.mkdirSync(results, { recursive: true });
  let browser, page, databaseConnection;
  const database = `sosmart_e2e_${process.pid}_${Date.now()}`;
  t.after(async () => {
    await browser?.close();
    for (const child of children.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, "exit");
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      }
    }
    if (databaseConnection) {
      try { await databaseConnection.query(`DROP DATABASE IF EXISTS \`${database}\``); }
      finally { await databaseConnection.end(); }
    }
  });

  for (const port of [14100, 18545, 13000, 13002]) {
    const probe = net.createServer().listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise((resolve) => probe.close(resolve));
  }
  const environment = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_RPC_URL: rpcUrl,
    NEXT_PUBLIC_AA_ENABLED: "false",
    LOCALHOST_RPC_URL: rpcUrl,
    GCT_RPC_URL: rpcUrl,
    GCT_CHAIN_ID: "31337",
    COSMETICS_CHAIN_ID: "31337",
    DB_HOST: process.env.DB_HOST || "127.0.0.1",
    DB_PORT: process.env.DB_PORT || "3306",
    DB_USER: process.env.DB_USER || "root",
    DB_PASSWORD: process.env.DB_PASSWORD || "",
    DB_NAME: database,
    PORT: "14100",
  };
  function start(label, component, args, extra = {}) {
    const log = fs.openSync(path.join(results, `${label}.log`), "w");
    const child = spawn(npm, args, {
      cwd: path.join(root, component), env: { ...environment, ...extra },
      detached: process.platform !== "win32", shell: process.platform === "win32",
      stdio: ["ignore", log, log],
    });
    fs.closeSync(log);
    children.push(child);
    return child;
  }
  async function run(label, component, args) {
    const child = start(label, component, args);
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${label} failed. See test-results/${label}.log`);
    return fs.readFileSync(path.join(results, `${label}.log`), "utf8");
  }
  async function waitReady(url, child, rpc = false) {
    for (let i = 0; i < 300; i++) {
      assert.equal(child.exitCode, null, `Server exited before ${url} was ready`);
      try {
        const r = await fetch(url, rpc ? {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        } : {});
        if (r.ok) return;
      } catch {}
      await delay(200);
    }
    throw new Error(`Server not ready: ${url}`);
  }
  async function api(route, body) {
    const r = await fetch(apiUrl + route, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await r.json();
    assert.ok(r.ok, JSON.stringify(data));
    return data;
  }
  databaseConnection = await mysql.createConnection({
    host: environment.DB_HOST, port: Number(environment.DB_PORT),
    user: environment.DB_USER, password: environment.DB_PASSWORD, multipleStatements: true,
  });
  await databaseConnection.query(fs.readFileSync(path.join(root, "api/sql/init.sql"), "utf8").replaceAll("green_commute", database));
  const chain = start("chain", "contracts", ["run", "node", "--", "--hostname", "127.0.0.1", "--port", "18545"]);
  await waitReady(rpcUrl, chain, true);
  const deployment = await run("deploy", "contracts", ["run", "deploy:localhost"]);
  environment.GCT_CONTRACT_ADDRESS = deployment.match(/GreenCommuteToken deployed to: (0x[0-9a-fA-F]{40})/)[1];
  environment.COSMETICS_CONTRACT_ADDRESS = deployment.match(/GreenCommuteCosmetics deployed to: (0x[0-9a-fA-F]{40})/)[1];
  // Standard public Hardhat test mnemonic, used only with this process's local node.
  environment.GCT_ORACLE_PRIVATE_KEY = ethers.Wallet.fromPhrase("test test test test test test test test test test test junk").privateKey;
  environment.COSMETICS_ADMIN_PRIVATE_KEY = environment.GCT_ORACLE_PRIVATE_KEY;
  const apiServer = start("api", "api", ["start"]);
  await waitReady(`${apiUrl}/health`, apiServer);

  t.diagnostic("Building production frontend and simulator for the isolated test stack.");
  await run("web-build", "web", ["run", "build"]);
  await run("simulator-build", "simulator", ["run", "build"]);
  const web = start("web", "web", ["start", "--", "--hostname", "127.0.0.1", "--port", "13000"]);
  const simulator = start("simulator", "simulator", ["start", "--", "--hostname", "127.0.0.1", "--port", "13002"]);
  await waitReady(webUrl, web);
  await waitReady(simulatorUrl, simulator);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Keep the QR image request local too; QR rendering itself is outside this test.
  await context.route("https://api.qrserver.com/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }));
  page = await context.newPage();
  const pageErrors = [];
  const apiFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api-proxy/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
  });
  page.setDefaultTimeout(20000);
  try {
    for (const route of ["/", "/analytics", "/profile", "/avatar", "/shop", "/community", "/chat"]) {
      const response = await page.goto(webUrl + route, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, route);
      assert.ok((await page.locator("body").innerText()).includes("sosmart Avatar Rewards"));
    }
    await page.goto(simulatorUrl, { waitUntil: "networkidle" });
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/dummy/once") && r.status() === 200),
      page.getByRole("button", { name: "Send once", exact: true }).click(),
    ]);
    assert.equal((await api("/api/stats/summary")).totalTrips, 1);
    const rpc = new ethers.JsonRpcProvider(rpcUrl);
    const rider = await (await rpc.getSigner(1)).getAddress();
    for (let i = 0; i < 3; i++) await api("/api/events", { walletAddress: rider, tripType: "bus", distanceKm: 30, source: "browser-test", ts: Date.now() });

    await context.addInitScript(({ address, rpcUrl }) => {
      const listeners = new Map();
      window.ethereum = {
        isMetaMask: true,
        on(event, handler) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(handler); },
        removeListener(event, handler) { listeners.get(event)?.delete(handler); },
        async request({ method, params = [] }) {
          if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [address];
          if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_switchEthereumChain") {
            if (params[0].chainId !== "0x7a69") throw new Error("Only the local test chain is available");
            return null;
          }
          const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          const payload = await response.json();
          if (payload.error) throw Object.assign(new Error(payload.error.message), payload.error);
          return payload.result;
        },
      };
    }, { address: rider, rpcUrl });
    await page.goto(`${webUrl}/profile`, { waitUntil: "networkidle" });
    await page.locator(".nav-desktop-only").getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("spinbutton").fill("60");
    await page.getByRole("button", { name: "Create Claim", exact: true }).click();
    await page.getByRole("button", { name: "Claim on-chain", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("confirmed"));
    assert.equal((await api(`/api/users/${rider}/claims`)).claims[0].claimStatus, "confirmed");
    const token = new ethers.Contract(environment.GCT_CONTRACT_ADDRESS, ["function balanceOf(address) view returns(uint256)"], rpc);
    assert.equal(await token.balanceOf(rider), ethers.parseEther("60"));

    const item = require("../web/public/items/items.json").find((entry) => entry.slot === "wallpaper");
    await page.goto(`${webUrl}/shop`, { waitUntil: "networkidle" });
    const card = page.locator(".shop-item").filter({ hasText: item.name });
    await card.getByRole("button", { name: "Buy", exact: true }).click();
    await card.getByRole("button", { name: "✓ Already owned", exact: true }).waitFor();
    const inventory = await api(`/api/users/${rider}/inventory`);
    assert.ok(inventory.ownedItemIds.includes(item.id));
    const cosmetics = new ethers.Contract(environment.COSMETICS_CONTRACT_ADDRESS, ["function balanceOf(address,uint256) view returns(uint256)"], rpc);
    assert.equal(await cosmetics.balanceOf(rider, item.tokenId), 1n);
    assert.equal(await token.balanceOf(rider), ethers.parseEther(String(60 - item.price)));
    await page.goto(`${webUrl}/avatar`, { waitUntil: "networkidle" });
    assert.ok((await page.locator("body").innerText()).includes(item.name));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(apiFailures, []);
    await page.screenshot({ path: path.join(results, "avatar.png"), fullPage: true });
    t.diagnostic("PASS: 7 routes, simulator, injected wallet, 60 GCT claim, token spend and ERC-1155 ownership.");
    rpc.destroy();
  } catch (error) {
    await page.screenshot({ path: path.join(results, "failure.png"), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(results, "browser-errors.json"), JSON.stringify({ pageErrors, apiFailures }, null, 2));
    throw error;
  }
});
