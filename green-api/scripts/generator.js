const API = process.env.API_URL || "http://localhost:4100";
const ENDPOINT = `${API}/api/events`;

const baseWallets = [
  "0xUserA000000000000000000000000000000000001",
  "0xUserB000000000000000000000000000000000002",
  "0xUserC000000000000000000000000000000000003",
  "0xUserD000000000000000000000000000000000004",
];

// Add your own wallet via EXTRA_WALLETS env var (comma-separated addresses)
const extraWallets = process.env.EXTRA_WALLETS
  ? process.env.EXTRA_WALLETS.split(",").map(w => w.trim()).filter(Boolean)
  : [];

const wallets = [...baseWallets, ...extraWallets];

const tripTypes = ["bus", "rail", "monorail", "park&ride"];

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendOne() {
  const body = {
    walletAddress: pick(wallets),
    tripType: pick(tripTypes),
    distanceKm: Number(rand(1, 18).toFixed(2)),
    routeId: "R-" + Math.floor(rand(1, 30)),
    stopId: "S-" + Math.floor(rand(1, 200)),
    source: "dummy-script",
    ts: Date.now()
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Failed:", res.status, t);
    return;
  }
  const data = await res.json();
  console.log("Sent", body.tripType, body.distanceKm, "km", "->", data.eventId);
}

async function loop() {
  console.log("Dummy generator started. Posting to:", ENDPOINT);
  while (true) {
    await sendOne();
    // random interval 5–20 sec
    const wait = Math.floor(rand(5000, 20000));
    await sleep(wait);
  }
}

loop().catch(console.error);
