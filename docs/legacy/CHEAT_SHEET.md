# Green Commute - Presentation Cheat Sheet

Practical speaker notes for demo day.
Format:
- `HU:` what to say in Hungarian
- `EN:` what to say in English
- `Tech:` short technical backup if they ask deeper questions

---

## 1. One-Sentence Pitch

`HU:` A Green Commute egy gamified fenntartható közlekedési app, ami jutalmazza a felhasználókat GCT tokennel, és ezt közösségi, avataros és NFT-s élménnyel köti össze.

`EN:` Green Commute is a gamified sustainable mobility app that rewards users with GCT tokens and turns that into a social, avatar-based, NFT-enabled experience.

`Tech:`
- Frontend: Next.js app
- Backend: Express + MySQL
- Blockchain: Ethereum Sepolia
- Wallet: Alchemy Account Kit embedded smart wallet + external wallet fallback
- Assets: ERC-20 reward token + ERC-1155 cosmetic NFTs

---

## 2. What Problem It Solves

`HU:` A cél az, hogy a fenntartható közlekedést ne csak mérjük, hanem motiválóvá tegyük. A felhasználó nem csak statisztikát lát, hanem jutalmat, fejlődést, közösségi státuszt és személyre szabható avatart is kap.

`EN:` The goal is not only to measure sustainable commuting, but to make it motivating. The user sees not just statistics, but also rewards, progression, community status, and a customizable avatar.

`Tech:`
- Commute events are stored in MySQL
- Reward logic calculates earned tokens from distance and mode
- The app exposes this through dashboard, analytics, profile, community, and shop flows

---

## 3. High-Level Architecture

`HU:` A rendszer három fő részből áll: a webes kliensből, a backend API-ból és a blokkláncos rétegből.

`EN:` The system has three main layers: the web client, the backend API, and the blockchain layer.

`Tech:`
- `green-dapp`: Next.js frontend
- `green-api`: Express API, MySQL-backed business logic
- `green-erc`: smart contracts for token and cosmetics
- Reverse proxy and deployment run separately on the server

### Architecture in one flow

`HU:` A frontend lekéri az adatokat a backendtől, a backend számol, validál és adatbázist kezel, a blokkláncot pedig csak azoknál a funkcióknál használjuk, ahol tényleg értelme van: claim, token, NFT és trade.

`EN:` The frontend fetches data from the backend, the backend handles calculation, validation, and persistence, and the blockchain is used only where it provides clear value: claiming, tokens, NFTs, and trading.

---

## 4. Frontend

`HU:` A frontend Next.js alapú, és moduláris oldalakból áll: Dashboard, Analytics, Profile, Avatar, Shop, Community és Chat.

`EN:` The frontend is built with Next.js and organized into modular pages: Dashboard, Analytics, Profile, Avatar, Shop, Community, and Chat.

`Tech:`
- App Router structure
- Reusable UI components such as `Nav`, `AvatarShowcase`, `NotificationBell`
- Mobile responsiveness handled mainly in shared CSS and page-level layout logic
- Inventory/UI state partly cached locally for a smoother avatar/shop experience

---

## 5. Backend

`HU:` A backend Express alapú REST API, ami üzleti logikát, statisztikát, jutalomszámítást, profilokat, közösségi funkciókat és a blokklánccal kapcsolatos validációt kezeli.

`EN:` The backend is an Express-based REST API that handles business logic, analytics, reward calculation, profiles, community features, and blockchain-related validation.

`Tech:`
- Main server in [`green-api/index.js`](/D:/gyakorlat/green-commute/green-api/index.js)
- Database access in [`green-api/db.js`](/D:/gyakorlat/green-commute/green-api/db.js)
- Uses MySQL via `mysql2/promise`
- Handles:
  - event ingestion
  - reward computation
  - claim lifecycle
  - shop purchase confirmation
  - avatar layout persistence
  - inventory reads
  - social/groups/chat/notifications
  - NFT trade hub and trade acceptance

### Simple backend explanation

`HU:` A backend a “single source of truth” az üzleti szabályokhoz. A frontend nem számol önállóan jutalmat vagy tulajdont, hanem kérdez és visszaigazol.

`EN:` The backend is the single source of truth for business rules. The frontend does not independently decide rewards or ownership; it requests and confirms them through the API.

---

## 6. Database / MySQL

`HU:` A MySQL-ben tároljuk a commute eventeket, a claim rekordokat, a vásárlásokat, az avatar layoutokat, a közösségi kapcsolatokat és a trade állapotokat.

`EN:` MySQL stores commute events, claim records, purchases, avatar layouts, social relationships, and trade states.

`Tech:`
- Example table families:
  - `events`
  - `reward_claims`
  - `shop_purchases`
  - `avatar_layouts`
  - `user_profiles`
  - `friend_requests`
  - `groups_social`, `group_members`, `group_invites`
  - `trade_listings`, `trade_offers`
  - `cosmetic_transfers`
  - notifications/chat-related tables

### Good short answer

`HU:` A MySQL nem csak tároló, hanem az app működésének gerince: innen épül a dashboard, az analytics, a profil és a közösségi réteg.

`EN:` MySQL is not just storage; it is the backbone of the app. The dashboard, analytics, profile, and community layer are all built from it.

---

## 7. Reward Logic

`HU:` A jutalom commute eventekből épül fel. A backend a megtett távolságot és közlekedési típust használja fel a jutalom és a CO2-megtakarítás becsléséhez.

`EN:` Rewards are built from commute events. The backend uses traveled distance and transport mode to estimate rewards and CO2 savings.

`Tech:`
- Wallet-specific reward totals are computed from stored events
- Output typically includes:
  - earned tokens
  - claimed tokens
  - claimable tokens
  - trip count
  - distance
  - CO2 saved

### If they ask “is it live?”

`HU:` Igen, a dashboard és analytics a backend aktuális adatbázis állapotából dolgozik, ezért az adatok frissíthetők és valós időközeliek.

`EN:` Yes, the dashboard and analytics are built from the current backend database state, so the data can be refreshed and is near real time.

---

## 8. GCT Token

`HU:` A GCT a saját jutalomt tokenünk. ERC-20 tokenként működik, tehát egy szabványos, osztható blockchain token.

`EN:` GCT is our reward token. It is implemented as an ERC-20 token, which means it is a standard fungible blockchain token.

`Tech:`
- Contract: [`GreenCommuteToken.sol`](/D:/gyakorlat/green-commute/green-erc/contracts/GreenCommuteToken.sol)
- Standard ERC-20 with signature-based claim flow
- Minting is not freely open to the user
- A valid off-chain signature from the configured oracle is required

### Important technical detail

`HU:` A token nem úgy működik, hogy a kliens “kedve szerint” mintel. A backend által aláírt claim szükséges hozzá, ezért kontrollált a kibocsátás.

`EN:` The token is not minted arbitrarily by the client. It requires a backend-signed claim, so token issuance remains controlled.

---

## 9. How Claim Works

`HU:` A claim kétlépcsős. Először a backend kiszámolja, mennyi jár, majd egy aláírt claim payloadot ad. Ezután a felhasználó a blokkláncon végrehajtja a claimet.

`EN:` Claiming is a two-step flow. First, the backend calculates how much the user can claim and produces a signed claim payload. Then the user executes that claim on-chain.

`Tech:`
- Contract uses EIP-712 typed data
- Claim fields:
  - user
  - amount
  - nonce
  - expiry
  - signature
- Contract checks:
  - caller must be the same user
  - signature must come from the oracle
  - claim must not be expired
  - nonce must not be reused

### Easy answer

`HU:` Ez biztonságosabb, mert a jogosultság backend oldalon dől el, a tényleges token kibocsátás pedig on-chain történik.

`EN:` This is safer because eligibility is decided on the backend, while the actual token issuance happens on-chain.

---

## 10. Embedded Wallet / Smart Wallet

`HU:` Az embedded wallet célja, hogy a felhasználó seed phrase nélkül is tudjon belépni és tranzakciózni. A walletélmény így sokkal közelebb kerül egy hagyományos apphoz.

`EN:` The goal of the embedded wallet is to let users sign in and transact without dealing with seed phrases. This makes the wallet experience much closer to a traditional app.

`Tech:`
- Unified wallet hook: [`useWallet.js`](/D:/gyakorlat/green-commute/green-dapp/lib/useWallet.js)
- Account Kit config: [`accountKitConfig.js`](/D:/gyakorlat/green-commute/green-dapp/lib/accountKitConfig.js)
- Uses Alchemy Account Kit
- Embedded mode creates/uses a LightAccount smart account on Sepolia
- Supported auth methods include Google social login and passkey
- External wallet fallback also exists

### Why this matters

`HU:` Ez nagyon fontos UX-szempontból, mert a nem kriptós felhasználók számára is használhatóvá teszi az appot.

`EN:` This matters a lot for UX because it makes the app usable even for non-crypto-native users.

---

## 11. Gasless Transactions

`HU:` A gasless működés azt jelenti, hogy a felhasználónak nem kell külön ETH-t tartania a tranzakciókhoz. A háttérben szponzorált user operation fut.

`EN:` Gasless means the user does not need to hold ETH just to perform transactions. In the background, a sponsored user operation is submitted.

`Tech:`
- Enabled through Alchemy transport and gas policy ID
- Typical flows using gas sponsorship:
  - reward claim
  - token burn transfer for shop purchase
  - embedded wallet actions

### Short line if asked “why useful?”

`HU:` Mert drasztikusan csökkenti a belépési küszöböt.

`EN:` Because it dramatically lowers the onboarding barrier.

---

## 12. Cosmetics / NFT Layer

`HU:` A kozmetikai tárgyak ERC-1155 NFT-ként működnek. Ez jobb választás volt, mint az ERC-721, mert sokféle itemet és mennyiséget hatékonyan kezel.

`EN:` Cosmetic items are implemented as ERC-1155 NFTs. This was a better fit than ERC-721 because it handles multiple item types and quantities more efficiently.

`Tech:`
- Contract: [`GreenCommuteCosmetics.sol`](/D:/gyakorlat/green-commute/green-erc/contracts/GreenCommuteCosmetics.sol)
- Based on:
  - ERC1155
  - ERC1155Burnable
  - ERC1155Supply
  - ERC1155URIStorage
- Supports:
  - single mint
  - batch mint
  - per-token URI
  - burn
  - minter allowlist

### Simple explanation

`HU:` A token a jutalom, az NFT pedig a személyre szabható digitális tárgy.

`EN:` The token is the reward, while the NFT is the personalized digital item.

---

## 13. Shop Flow

`HU:` A shopban a felhasználó GCT-ért kozmetikai itemet vesz. A vásárlás után az item NFT-ként megjelenik az inventoryban és használható az avataron.

`EN:` In the shop, the user buys cosmetic items using GCT. After purchase, the item appears in the inventory as an NFT and can be used on the avatar.

`Tech:`
- Shop UI in [`app/shop/page.jsx`](/D:/gyakorlat/green-commute/green-dapp/app/shop/page.jsx)
- Purchase logic:
  1. frontend loads rewards and inventory
  2. user picks an item
  3. frontend sends token transfer/burn-style payment transaction
  4. backend validates purchase and records it
  5. backend ensures the cosmetic NFT exists on-chain for the wallet

### Important nuance

`HU:` A shop nem pusztán UI-szimuláció, hanem backend-validált és blockchainnel összekötött flow.

`EN:` The shop is not just a UI simulation; it is a backend-validated flow connected to the blockchain.

---

## 14. Avatar System

`HU:` Az avatar réteges PNG-összeállításból épül fel: háttér, haj, fejfedő, felső, alsó, cipő, kiegészítők és így tovább.

`EN:` The avatar is built as a layered PNG composition: background, hair, headwear, top, bottom, shoes, accessories, and so on.

`Tech:`
- Main page: [`app/avatar/page.jsx`](/D:/gyakorlat/green-commute/green-dapp/app/avatar/page.jsx)
- Local inventory cache: [`app/lib/inventory.js`](/D:/gyakorlat/green-commute/green-dapp/app/lib/inventory.js)
- Avatar layout is saved to backend
- Equipped items and offsets are persisted
- Only owned cosmetics are allowed to be used

### Good live-demo explanation

`HU:` Az avatar nem csak vizuális extra, hanem a jutalmazási és közösségi rendszer egyik központi eleme.

`EN:` The avatar is not just a visual extra; it is one of the central pieces of the reward and community system.

---

## 15. Why Avatar Uses Both Local and API State

`HU:` A lokális tárolás a gyors és kényelmes kliensélmény miatt kell, az API pedig a tartós és több eszközről is elérhető mentés miatt.

`EN:` Local storage is used for a fast and convenient client-side experience, while the API provides durable, cross-device persistence.

`Tech:`
- Local:
  - quick UI state
  - responsive dressing / preview
- API:
  - wallet-linked layout
  - server persistence
  - public profile rendering

---

## 16. Inventory

`HU:` Az inventory azt mondja meg, milyen tárgyakat birtokol a felhasználó, és ezekből melyik van épp felszerelve.

`EN:` The inventory defines which items the user owns and which of them are currently equipped.

`Tech:`
- Owned item IDs come from backend inventory endpoint
- Local state stores:
  - `owned`
  - `equipped`
  - `offsets`
- Inventory is refreshed after shop or trade actions

---

## 17. Trade / NFT Trading

`HU:` A felhasználók NFT kozmetikai tárgyakat is cserélhetnek egymással. Ez listing és offer modellben működik.

`EN:` Users can trade cosmetic NFTs with each other. This works through a listing-and-offer model.

`Tech:`
- Backend stores:
  - open listings
  - offers
  - trade statuses
- Accepting a trade triggers on-chain ERC-1155 transfers
- Trade operator approval is required
- Transfer history is persisted in `cosmetic_transfers`

### Easy explanation

`HU:` A trade lényege, hogy a shopban megszerzett itemek később közösségi értéket is kapnak.

`EN:` The key point of trading is that shop items later gain social and exchange value.

---

## 18. Community

`HU:` A community réteg profilokat, barátlistát, friend requesteket, csoportokat és leaderboardot ad az alkalmazásnak.

`EN:` The community layer adds profiles, friends, friend requests, groups, and leaderboards to the application.

`Tech:`
- Main page: [`app/community/page.jsx`](/D:/gyakorlat/green-commute/green-dapp/app/community/page.jsx)
- Public profile page exists per wallet
- Community names are stored server-side
- Groups have membership, invites, and ranking-related logic

### If asked “why this matters?”

`HU:` Mert a fenntarthatóságot közösségi élménnyé alakítja, nem csak egyéni statisztikává.

`EN:` Because it turns sustainability into a social experience, not just an individual statistic.

---

## 19. Dashboard

`HU:` A dashboard gyors áttekintést ad a teljes rendszer állapotáról: utak száma, távolság, CO2-megtakarítás, közlekedési módok és leaderboard.

`EN:` The dashboard provides a quick overview of the overall system state: trip count, distance, CO2 savings, transport modes, and leaderboard.

`Tech:`
- Fed mainly from aggregated backend endpoints
- Built from MySQL event data
- Auto-refresh behavior is supported in the UI

---

## 20. Analytics

`HU:` Az analytics mélyebb bontást ad idősorokra, közlekedési módokra, peak hours mintákra és összesített metrikákra.

`EN:` Analytics provides a deeper breakdown into time series, transport modes, peak-hour patterns, and aggregated metrics.

`Tech:`
- Global and wallet-specific views
- Bucketed time-series
- Mode split
- Peak-hour charts
- Uses backend aggregation, not client-side guessing

---

## 21. Notifications and Chat

`HU:` Az értesítési réteg segít a social és trade események követésében. A chat réteg a közösségi élmény bővítése felé mutat.

`EN:` The notification layer helps users track social and trade events. The chat layer points toward a broader community experience.

`Tech:`
- Notification bell polls backend notification endpoints
- Routes users into relevant flows
- Chat is present in the app structure and social UX, even if some parts are lighter-weight than core reward/token logic

---

## 22. Security Story

`HU:` A blockchainhez kötött részeknél validáció van: claim signature, nonce, expiry, on-chain transaction ellenőrzés, ownership check, operator approval.

`EN:` The blockchain-connected flows are validated: claim signatures, nonces, expiries, on-chain transaction checks, ownership checks, and operator approvals.

`Tech:`
- Claim uses oracle-signed EIP-712 payload
- NFT trade requires approval and ownership validation
- Backend verifies critical transaction assumptions before final confirmation

---

## 23. Why Sepolia

`HU:` A projekt jelenleg Sepolia teszthálózaton fut, mert így valós blockchain-integrációt lehet mutatni pénzügyi kockázat nélkül.

`EN:` The project currently runs on the Sepolia testnet so that real blockchain integration can be demonstrated without financial risk.

`Tech:`
- Real wallet flow
- Real smart contracts
- Real transactions
- Lower risk, easier iteration, safer demo

---

## 24. If They Ask “What Is Actually On-Chain?”

`HU:` On-chain van a GCT token, a claim végrehajtása, a kozmetikai NFT-k, valamint a trade-hez kapcsolódó NFT átadások.

`EN:` On-chain we have the GCT token, the execution of reward claims, the cosmetic NFTs, and the NFT transfers related to trading.

`Tech:`
- Off-chain / DB:
  - commute events
  - analytics aggregates
  - profile/community metadata
  - listings/offers state
- On-chain:
  - ERC-20 balances
  - ERC-1155 balances
  - claim minting
  - approved transfers

---

## 25. If They Ask “Why Not Put Everything On-Chain?”

`HU:` Mert nem lenne költséghatékony és UX szempontból sem lenne jó. A statisztika, közösségi metaadat és gyors UI-állapot jobb adatbázisban, míg a tulajdonjog és tokenizált érték jobb blokkláncon.

`EN:` Because it would not be cost-efficient and would hurt UX. Analytics, social metadata, and fast UI state are better kept in a database, while ownership and tokenized value are better kept on-chain.

---

## 26. If They Ask “What Makes This More Than a Demo UI?”

`HU:` Az, hogy a rendszer végigér a teljes láncon: adatbázis, üzleti logika, wallet, aláírt claim, on-chain token, NFT inventory és trade.

`EN:` The reason it is more than a demo UI is that it completes the full chain: database, business logic, wallet flow, signed claims, on-chain token, NFT inventory, and trading.

---

## 27. Strong Closing

`HU:` Összességében a Green Commute nem csak egy dashboard vagy egy web3 kísérlet, hanem egy olyan prototípus, ami a fenntartható közlekedést jutalmazási, közösségi és digitális tulajdonlási élménnyé alakítja.

`EN:` Overall, Green Commute is not just a dashboard or a web3 experiment, but a prototype that turns sustainable commuting into a rewarding, social, and digitally ownable experience.

---

## 28. Fast Q&A Answers

### “How does the backend work?”
`HU:` Express API + MySQL. A backend számol, validál, ment és koordinálja a blockchainnel összekötött flow-kat.
`EN:` Express API + MySQL. The backend computes, validates, persists, and coordinates blockchain-connected flows.

### “How does the token work?”
`HU:` ERC-20 token, amit nem szabadon mintel a user, hanem backend által aláírt claim alapján kap meg.
`EN:` It is an ERC-20 token that the user cannot mint freely; it is claimed through a backend-signed authorization flow.

### “How do NFTs work here?”
`HU:` ERC-1155 kozmetikai itemek, amelyeket a shopból lehet megszerezni és az avatárra felszerelni, illetve eltrade-elni.
`EN:` They are ERC-1155 cosmetic items that users can acquire in the shop, equip on avatars, and trade.

### “What is the embedded wallet?”
`HU:` Egy smart wallet élmény Google bejelentkezéssel, seed phrase nélkül.
`EN:` It is a smart-wallet experience with Google sign-in and no seed phrase friction.

### “How does the shop work?”
`HU:` Tokenfizetés + backend validáció + NFT jóváírás.
`EN:` Token payment + backend validation + NFT assignment.

### “How does the avatar work?”
`HU:` Réteges PNG-rendszer, inventoryhoz kötve, mentett layouttal és felszerelhető NFT itemekkel.
`EN:` A layered PNG system tied to inventory, with saved layouts and equippable NFT items.

### “Why is this useful for users?”
`HU:` Mert a fenntartható viselkedést kézzelfogható jutalommá és közösségi identitássá alakítja.
`EN:` Because it turns sustainable behavior into something tangible: rewards and social identity.

---

## 29. Final Reminder for Your Demo

Say the story in this order:
1. Problem
2. Reward logic
3. Wallet simplicity
4. Token claim
5. NFT cosmetics
6. Avatar personalization
7. Community and trade
8. Why this can grow further

Best short close:

`HU:` Nem csak mérjük a zöld közlekedést, hanem értéket és élményt építünk köré.

`EN:` We do not just measure green commuting, we build value and experience around it.
