# NeuroWealth AI Decision Agent

The NeuroWealth agent is an autonomous background service that continuously monitors yield opportunities across Stellar DeFi protocols (Blend Protocol, Soroswap/Phoenix DEX pools) and executes rebalancing for vault participants.

---

## Key Modules

- **Yield Comparison Engine** (`src/yieldComparison.ts`): Aggregates real-time and historical (7d/30d/90d) APYs, calculating risk-adjusted return ratios (Sharpe-like metric) and enforcing the 0.5% minimum improvement threshold.
- **Risk Scoring Engine** (`src/riskScoring.ts`): Multi-dimensional risk evaluation (smart contract, liquidity, oracle, governance, centralization risks) to determine protocol eligibility and risk thresholds.
- **Intent Parser** (`src/intentParser.ts`): Natural language parsing for WhatsApp & chat commands.
- **Event Listener** (`src/eventListener.ts`): Real-time contract event ingestion.
