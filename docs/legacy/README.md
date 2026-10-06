# Okinawa Public Transport

A gamified public transport rewards platform with a full avatar system, social community features, group challenges, and on-chain token flows.

## Overview

This project combines:

- a `Next.js` frontend for the user experience
- a `Node.js + Express` backend API
- a local ERC-20 token flow for claiming and spending rewards
- avatar customization with wardrobe, wallpapers, presets, and sharing
- social features such as friends, groups, chat, leaderboards, and public profiles

The goal is to make sustainable commuting more engaging through rewards, identity, and community interaction.

## Project Structure

```text
green-commute/
  green-api/    Backend API, MySQL integration, rewards, claims, social logic
  green-dapp/   Next.js frontend, avatar editor, shop, community, chat
  green-erc/    Token contract and local chain tooling
  green-dummy/  Local dummy / support tooling
```

## Main Features

- Reward calculation from transport events
- On-chain reward claiming
- Cosmetic item shop using token balance
- Full-body avatar editor
- Wardrobe system with hats, tops, bottoms, accessories, wallpapers
- Outfit presets and avatar sharing
- Public community profiles
- Friend requests and friend list
- Groups with roles, invites, chat, challenges, and crown rewards
- Rider and group leaderboards
- Messenger-style chat for direct and group conversations

## Tech Stack

- `Next.js`
- `React`
- `wagmi`
- `ethers`
- `Node.js`
- `Express`
- `MySQL`
- `Hardhat`

## Getting Started

### 1. Install dependencies

Install dependencies in the project parts you want to run:

```bash
cd green-dapp
npm install
```

```bash
cd green-api
npm install
```

```bash
cd green-erc
npm install
```

### 2. Configure environment variables

Create the required `.env` files for:

- `green-api`
- `green-dapp` if needed
- `green-erc` if needed

Do not commit real secrets or private keys.

### 3. Start the backend

```bash
cd green-api
npm run dev
```

### 4. Start the frontend

```bash
cd green-dapp
npm run dev
```

### 5. Start the local chain

If you use the on-chain claim and purchase flow locally:

```bash
cd green-erc
npx hardhat node
```

Then deploy the token contract and update the backend/frontend config if needed.

## Notes

- Purchases and avatar ownership are persisted through the backend database.
- Crown group rewards are claimed with an on-chain confirmation transaction.
- The avatar page merges wardrobe management and avatar editing into one flow.
- Public profiles intentionally focus on community-visible data only.

## Development Status

This is an actively iterated university / portfolio-style project with a strong focus on:

- transport reward gamification
- customizable avatar identity
- social retention features
- clean incremental product growth

## Author

Built by Horvath Levente
