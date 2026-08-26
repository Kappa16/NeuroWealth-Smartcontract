import { YieldComparisonEngine, ProtocolYieldData } from './yieldComparison';

describe('YieldComparisonEngine', () => {
  let engine: YieldComparisonEngine;

  beforeEach(() => {
    engine = new YieldComparisonEngine(0.005, 0.04);
  });

  const mockProtocols: ProtocolYieldData[] = [
    {
      protocolId: 'blend-usdc',
      name: 'Blend USDC Lending',
      type: 'blend',
      currentApy: 0.082,
      historicalApy7d: 0.081,
      historicalApy30d: 0.080,
      tvlUsdc: 5_000_000,
      volatility: 0.015,
      riskScore: 20,
    },
    {
      protocolId: 'dex-usdc-xlm',
      name: 'Soroswap USDC/XLM Pool',
      type: 'dex_lp',
      currentApy: 0.125,
      historicalApy7d: 0.118,
      historicalApy30d: 0.110,
      tvlUsdc: 1_200_000,
      volatility: 0.065,
      riskScore: 45,
    },
  ];

  it('ranks opportunities by risk-adjusted return', () => {
    const ranked = engine.rankOpportunities(mockProtocols);
    expect(ranked.length).toBe(2);
    expect(ranked[0].riskAdjustedScore).toBeGreaterThan(0);
  });

  it('enforces 0.5% minimum improvement rebalance threshold', () => {
    expect(engine.shouldRebalance(0.080, 0.086)).toBe(true);  // +0.6% > 0.5%
    expect(engine.shouldRebalance(0.080, 0.083)).toBe(false); // +0.3% < 0.5%
  });
});
