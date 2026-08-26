export interface ProtocolYieldData {
  protocolId: string;
  name: string;
  type: 'blend' | 'dex_lp' | 'other';
  currentApy: number; // e.g. 0.085 for 8.5%
  historicalApy7d: number;
  historicalApy30d: number;
  tvlUsdc: number;
  volatility: number; // annualized volatility e.g. 0.02
  riskScore: number;  // 1-100 from risk scoring engine
}

export interface YieldOpportunity {
  protocolId: string;
  name: string;
  netApy: number;
  riskAdjustedScore: number;
  recommendedAllocationPercent: number;
}

export class YieldComparisonEngine {
  private readonly minImprovementThreshold: number;
  private readonly riskFreeRate: number;

  constructor(minImprovementThreshold = 0.005, riskFreeRate = 0.04) {
    this.minImprovementThreshold = minImprovementThreshold;
    this.riskFreeRate = riskFreeRate;
  }

  public calculateSharpeRatio(apy: number, volatility: number): number {
    if (volatility <= 0) return apy / 0.01;
    return (apy - this.riskFreeRate) / volatility;
  }

  public rankOpportunities(protocols: ProtocolYieldData[]): YieldOpportunity[] {
    return protocols
      .map((p) => {
        const sharpe = this.calculateSharpeRatio(p.currentApy, p.volatility);
        // Risk-adjusted metric combines sharpe with inverse risk penalty
        const riskPenalty = (100 - p.riskScore) / 100;
        const riskAdjustedScore = sharpe * riskPenalty;

        return {
          protocolId: p.protocolId,
          name: p.name,
          netApy: p.currentApy,
          riskAdjustedScore: Math.round(riskAdjustedScore * 100) / 100,
          recommendedAllocationPercent: 0,
        };
      })
      .sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore);
  }

  public shouldRebalance(currentApy: number, targetApy: number): boolean {
    return targetApy - currentApy >= this.minImprovementThreshold;
  }
}
