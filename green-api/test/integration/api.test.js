const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const mysql = require("mysql2/promise");

// Use an isolated database per run; never load the developer's .env here.
test("MySQL API: health, events, limits, rewards, claims and notifications", { timeout: 45000 }, async (t) => {
  const database = `sosmart_test_${process.pid}_${Date.now()}`;
  const credentials = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  };
  const sql = await mysql.createConnection({ ...credentials, multipleStatements: true });
  t.after(async () => {
    try { await sql.query(`DROP DATABASE IF EXISTS \`${database}\``); }
    finally { await sql.end(); }
  });
  const schema = await readFile(path.join(__dirname, "../../sql/init.sql"), "utf8");
  await sql.query(schema.replaceAll("green_commute", database));

  const reserve = net.createServer().listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const server = spawn(process.execPath, ["index.js"], {
    cwd: path.join(__dirname, "../.."),
    env: {
      ...process.env, PORT: String(port), DB_NAME: database,
      DB_HOST: credentials.host, DB_PORT: String(credentials.port),
      DB_USER: credentials.user, DB_PASSWORD: credentials.password,
      GCT_CONTRACT_ADDRESS: "", COSMETICS_CONTRACT_ADDRESS: "",
      GCT_ORACLE_PRIVATE_KEY: "", COSMETICS_ADMIN_PRIVATE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, logs);
  async function request(route, body) {
    const response = await fetch(base + route, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  assert.equal((await request("/health")).db, "connected");
  const wallet = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
  for (let index = 0; index < 3; index++) {
    await request("/api/events", { walletAddress: wallet, tripType: "bus", distanceKm: 10, source: "integration-test", ts: Date.now() });
  }
  assert.equal((await request("/api/events?limit=2")).count, 2);
  assert.equal((await request("/api/events?limit=2.9")).count, 2);
  assert.equal((await request("/api/events?limit=-2")).count, 1);
  assert.equal((await request("/api/events?limit=invalid")).count, 3);
  assert.equal((await request("/api/stats/summary")).totalTrips, 3);
  assert.equal((await request(`/api/users/${wallet}/rewards`)).earnedTokens, 30);
  await request(`/api/users/${wallet}/claim`, { amountTokens: 5 });
  assert.equal((await request("/api/claims?limit=1")).count, 1);
  await sql.execute(`INSERT INTO notifications (wallet_address, type, title, body) VALUES (?, 'test', 'Test', 'Test')`, [wallet]);
  const notifications = await request(`/api/users/${wallet}/notifications?limit=1`);
  assert.equal(notifications.notifications.length, 1);
  assert.equal((await request(`/api/users/${wallet}/notifications?limit=invalid`)).notifications.length, 1);

  // Liveness must not mask a failed database readiness check.
  await sql.query(`DROP DATABASE \`${database}\``);
  assert.equal((await fetch(`${base}/health`)).status, 500);
});
