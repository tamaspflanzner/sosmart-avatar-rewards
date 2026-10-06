# sosmart Avatar Rewards

Earn blockchain rewards through sustainable commuting and redeem them for avatar cosmetics.

A sosmart module built from Green Commute: transport events produce rewards, users claim GCT tokens on chain, and the in-app shop offers avatar clothing, accessories and backgrounds. Contracts implement an ERC-20 reward token and ERC-1155 cosmetics. Avatar upgrades are cosmetic, not character statistics.

## Components

| Directory | Purpose | Stack |
| --- | --- | --- |
| green-dapp | User interface and wallet integration | Next.js 16.1.6, React 19.2.3, Tailwind 4, wagmi, viem, TanStack Query, optional Alchemy Account Kit |
| green-api | Events, rewards, social features, SQL persistence, chain verification | Node.js, Express 5, mysql2, Zod, ethers 6 |
| green-erc | Reward and cosmetic contracts | Solidity 0.8.24, Hardhat 2.26.3, OpenZeppelin 5.0.2, ethers 5 |
| green-dummy | Controls synthetic commute events | Next.js and React |

Keep these directory names: the contract deployment catalog reads assets from green-dapp. Each component has its own package-lock.json; there is no root npm workspace.

## Local setup

The source snapshot was exercised with Node.js 24.21.0, npm 11.19.0 and MySQL 8.3. The MySQL event-list issue below remains unresolved.

Run in the repository root:

```bash
for dir in green-api green-dapp green-dummy green-erc; do
  (cd "$dir" && npm ci)
done
cp green-api/.env.example green-api/.env
cp green-dapp/.env.local.example green-dapp/.env.local
```

Start MySQL and configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in green-api/.env. Import the schema (the command below requires a MySQL client):

```bash
mysql -u root -p < green-api/sql/init.sql
```

The schema creates green_commute. Backend startup creates some additional tables, but does not replace schema import.

Start each service in a separate terminal:

```bash
cd green-api
npm run dev
```

```bash
cd green-dapp
npm run dev -- --webpack --port 3000
```

```bash
# Optional synthetic-event control panel
cd green-dummy
npm run dev -- --port 3002
```

API: http://localhost:4100. App: http://localhost:3000. Dummy controls: http://localhost:3002. Use Send once or Start to generate events. Database-backed statistics work without blockchain credentials; wallet transactions require the configuration below.

```bash
curl http://localhost:4100/api/debug/db
curl http://localhost:4100/api/stats/summary
```

The first registered /health handler only proves that the HTTP process is alive; use /api/debug/db for a database check.

## Blockchain configuration

For the local contract/API flow, start a node in green-erc, then deploy from a second terminal:

```bash
npm run node
# Separate terminal in green-erc:
npm run deploy:localhost
```

Set these backend values and restart the API:

- GCT_CONTRACT_ADDRESS and COSMETICS_CONTRACT_ADDRESS: deployment output.
- GCT_CHAIN_ID=31337 and COSMETICS_CHAIN_ID=31337.
- GCT_RPC_URL=http://127.0.0.1:8545.
- GCT_ORACLE_PRIVATE_KEY: the local test key matching the deployed token oracle (the first Hardhat account by default).
- COSMETICS_ADMIN_PRIVATE_KEY: defaults to GCT_ORACLE_PRIVATE_KEY when empty; it must have mint permission.

A new local chain requires redeployment. The deploy script compiles the contracts; generated artifacts are not stored in Git.

The frontend currently configures Sepolia directly in green-dapp/lib/wagmiConfig.js, with an Alchemy RPC. Setting NEXT_PUBLIC_CHAIN_ID alone does not switch the network. To use a local wallet end to end, adapt the frontend chain and transport configuration. For Sepolia, configure corresponding deployed contracts, backend RPC/oracle values and NEXT_PUBLIC_ALCHEMY_API_KEY. Leave NEXT_PUBLIC_AA_ENABLED=false unless intentionally configuring embedded Alchemy accounts.

## Verification and known limitations

The original source snapshot was checked before import:

- npm ci succeeded in all four components.
- Both Next.js production builds passed; contracts compiled and deployed locally.
- Seven main app routes loaded in Chromium without a connected wallet; the dummy Send once button worked.
- API-driven event -> reward -> signature -> local chain transaction -> database confirmation succeeded with 5 GCT credited.
- Default dapp npm run dev fails due to the Webpack/Turbopack configuration mismatch; use --webpack.
- MySQL 8.3 returned HTTP 500 for the event list: numeric LIMIT ? parameters fail through mysql2.execute. This also affects the dashboard feed.
- Dapp lint: 8 errors, 41 warnings. Dummy lint: 1 error. These are not fixed by this import.
- No substantive automated test suite was found. Wallet UI, Alchemy login and all shop/social operations were not verified end to end.

Run npm run build and npm run lint separately in each Next.js component. After a successful build, npm start serves the production app; use -- --port 3002 for the dummy if running both.

## Source and documentation

See [PROVENANCE.md](PROVENANCE.md) for the original repository, revision and licensing status. Historical documents remain in docs/legacy and are not the current startup guide.

This import changes repository hygiene and documentation only. Runtime code, package locks, SQL, artwork, ABI modules and existing author/license notices are preserved.
