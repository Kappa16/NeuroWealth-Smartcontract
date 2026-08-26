import { ProtocolRiskScoringEngine, RiskDimensionScores } from './riskScoring';

describe('ProtocolRiskScoringEngine', () => {
  let engine: ProtocolRiskScoringEngine;

  beforeEach(() => {
    engine = new ProtocolRiskScoringEngine();
  });

  it('calculates weighted composite score accurately', () => {
    const scores: RiskDimensionScores = {
      smartContractRisk: 20,
      liquidityRisk: 30,
      oracleRisk: 25,
      governanceRisk: 40,
      centralizationRisk: 20,
    };
    // 20*0.30 + 30*0.25 + 25*0.20 + 40*0.15 + 20*0.10 = 6 + 7.5 + 5 + 6 + 2 = 26.5
    const composite = engine.calculateCompositeRisk(scores);
    expect(composite).toBe(26.5);
    expect(engine.getRiskCategory(composite)).toBe('LOW');
  });

  it('identifies critical risk and triggers rebalance alerts', () => {
    const highRiskScores: RiskDimensionScores = {
      smartContractRisk: 85,
      liquidityRisk: 80,
      oracleRisk: 75,
      governanceRisk: 90,
      centralizationRisk: 80,
    };
    const composite = engine.calculateCompositeRisk(highRiskScores);
    expect(composite).toBeGreaterThan(80);
    expect(engine.getRiskCategory(composite)).toBe('CRITICAL');
    expect(engine.shouldTriggerRebalanceAlert(composite)).toBe(true);
  });
});
