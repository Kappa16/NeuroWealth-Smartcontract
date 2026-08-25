/**
 * Collects on-chain health metrics from vault contract
 */

import { VaultClient, DECIMAL_PLACES } from "@neurowealth/vault-client";
import * as StellarSdk from "@stellar/stellar-sdk";
import pino from "pino";
import { HealthMetrics, MonitoringConfig } from "./types";

export class MetricsCollector {
  private client: VaultClient;
  private logger = pino();
  private lastMetrics: HealthMetrics | null = null;

  constructor(private config: MonitoringConfig) {
    this.client = new VaultClient({
      contractId: config.contractId,
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
    });
  }

  async collectMetrics(): Promise<HealthMetrics> {
    try {
      const server = new StellarSdk.SorobanRpc.Server(this.config.rpcUrl);
      const ledger = await server.getLatestLedger();

      // Use a dummy public key for read-only queries
      const dummyKey = StellarSdk.Keypair.random().publicKey();

      // Fetch all metrics in parallel
      const [
        totalAssets,
        totalShares,
        totalDeposits,
        isPaused,
        currentProtocol,
        owner,
        agent,
        tvlCap,
        userDepositCap,
        pendingUpgrade,
        pendingAgent,
      ] = await Promise.all([
        this.client.get_total_assets(dummyKey),
        this.client.get_total_shares(dummyKey),
        this.client.get_total_deposits(dummyKey),
        this.client.is_paused(dummyKey),
        this.client.get_current_protocol(dummyKey),
        this.client.get_owner(dummyKey),
        this.client.get_agent(dummyKey),
        this.client.get_tvl_cap(dummyKey),
        this.client.get_user_deposit_cap(dummyKey),
        this.client.get_pending_upgrade(dummyKey).catch(() => null),
        this.client.get_pending_agent_update(dummyKey).catch(() => null),
      ]);

      // Calculate share price
      const sharePrice =
        totalShares > 0n ? Number(totalAssets) / Number(totalShares) : 0;

      const metrics: HealthMetrics = {
        timestamp: Date.now(),
        ledgerSequence: ledger.sequence,
        tvl: totalAssets,
        totalShares,
        totalDeposits,
        isPaused,
        currentProtocol,
        owner,
        agent,
        sharePrice,
        tvlCap,
        userDepositCap,
        pendingUpgrade: pendingUpgrade
          ? {
              hash: (pendingUpgrade as any).wasm_hash || "",
              expiryLedger: (pendingUpgrade as any).expiry || 0,
            }
          : undefined,
        pendingAgent: pendingAgent
          ? {
              hash: (pendingAgent as any).agent || "",
              expiryLedger: (pendingAgent as any).expiry || 0,
            }
          : undefined,
      };

      this.lastMetrics = metrics;
      this.logger.info(
        { metrics: this.formatMetricsForLog(metrics) },
        "Metrics collected",
      );

      return metrics;
    } catch (error) {
      this.logger.error({ error }, "Failed to collect metrics");
      throw error;
    }
  }

  getLastMetrics(): HealthMetrics | null {
    return this.lastMetrics;
  }

  private formatMetricsForLog(metrics: HealthMetrics) {
    return {
      ledger: metrics.ledgerSequence,
      tvl_usdc: Number(metrics.tvl / BigInt(10 ** DECIMAL_PLACES)),
      total_shares: metrics.totalShares.toString(),
      share_price: metrics.sharePrice.toFixed(4),
      is_paused: metrics.isPaused,
      protocol: metrics.currentProtocol,
      owner: metrics.owner.slice(0, 10) + "...",
      agent: metrics.agent.slice(0, 10) + "...",
    };
  }
}
