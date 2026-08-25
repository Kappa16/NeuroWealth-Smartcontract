# NeuroWealth Frontend Dashboard

Next.js 15 Web Application with Tailwind CSS, `@stellar/stellar-sdk`, `@stellar/freighter-api`, and Recharts portfolio analytics.

## Features
- **Next.js 15 App Router**: High-performance React 18 server and client components.
- **Tailwind CSS Design System**: Vibrant dark mode UI with glassmorphism panels, custom color tokens, and micro-interactions.
- **Freighter Wallet Integration**: Non-custodial wallet connection & transaction signing.
- **Vault Contract Integration**: Connects to Soroban vault smart contract getters (`get_balance`, `get_exchange_rate`, `get_user_strategy`).
- **Portfolio Analytics**: Interactive Recharts area chart for tracking portfolio growth and accrued yield.
- **Deposit & Withdraw Modal**: Previews share minting/burning rates with real-time exchange rates.
- **Transaction History**: Displays recent on-chain events with Stellar Explorer links.

## Setup & Running
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.
