/**
 * Main bridge manager - orchestrates cross-chain transfers via Axelar
 */

import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import * as StellarSdk from "@stellar/stellar-sdk";
import { ethers } from "ethers";
import axios from "axios";
import {
  BridgeConfig,
  BridgeTransfer,
  BridgeQuote,
  BridgeStatus,
  StoredBridgeTransfer,
} from "./types";

export class BridgeManager {
  private logger = pino();
  private stellarServer: StellarSdk.SorobanRpc.Server;
  private ethersProvider: ethers.Provider;
  private bridgeTransfers: Map<string, StoredBridgeTransfer> = new Map();

  constructor(private config: BridgeConfig) {
    this.stellarServer = new StellarSdk.SorobanRpc.Server(config.stellarRpcUrl);
    this.ethersProvider = new ethers.JsonRpcProvider(config.ethereumRpcUrl);
  }

  /**
   * Initiate a deposit from Ethereum → Stellar via Axelar
   */
  async initiateEthereumDeposit(
    ethereumUserAddress: string,
    usdcAmount: bigint,
    destinationStellarAddress: string,
  ): Promise<BridgeTransfer> {
    this.logger.info(
      {
        ethereumUserAddress,
        usdcAmount: usdcAmount.toString(),
        destinationStellarAddress,
      },
      "Initiating Ethereum → Stellar deposit",
    );

    // Validate amount
    if (usdcAmount < this.config.minBridgeAmount) {
      throw new Error(
        `Amount below minimum: ${this.config.minBridgeAmount.toString()}`,
      );
    }
    if (usdcAmount > this.config.maxBridgeAmount) {
      throw new Error(
        `Amount above maximum: ${this.config.maxBridgeAmount.toString()}`,
      );
    }

    // Calculate bridge fee
    const bridgeFee =
      (usdcAmount * BigInt(Math.floor(this.config.bridgeFeePercentage * 100))) /
      BigInt(10000);
    const netAmount = usdcAmount - bridgeFee;

    const transfer: BridgeTransfer = {
      id: uuidv4(),
      status: "pending",
      direction: "deposit",
      sourceChain: "ethereum",
      destinationChain: "stellar",
      user: destinationStellarAddress,
      amount: usdcAmount,
      bridgeFee,
      netAmount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Store transfer
    this.bridgeTransfers.set(transfer.id, {
      ...transfer,
      retriesRemaining: 3,
    });

    this.logger.info(
      { transferId: transfer.id, status: transfer.status },
      "Bridge transfer initiated",
    );

    return transfer;
  }

  /**
   * Initiate a withdrawal from Stellar → Ethereum via Axelar
   */
  async initiateStellarWithdraw(
    stellarUserAddress: string,
    usdcAmount: bigint,
    destinationEthereumAddress: string,
  ): Promise<BridgeTransfer> {
    this.logger.info(
      {
        stellarUserAddress,
        usdcAmount: usdcAmount.toString(),
        destinationEthereumAddress,
      },
      "Initiating Stellar → Ethereum withdrawal",
    );

    // Validate amount
    if (usdcAmount < this.config.minBridgeAmount) {
      throw new Error(
        `Amount below minimum: ${this.config.minBridgeAmount.toString()}`,
      );
    }
    if (usdcAmount > this.config.maxBridgeAmount) {
      throw new Error(
        `Amount above maximum: ${this.config.maxBridgeAmount.toString()}`,
      );
    }

    // Calculate bridge fee
    const bridgeFee =
      (usdcAmount * BigInt(Math.floor(this.config.bridgeFeePercentage * 100))) /
      BigInt(10000);
    const netAmount = usdcAmount - bridgeFee;

    const transfer: BridgeTransfer = {
      id: uuidv4(),
      status: "pending",
      direction: "withdraw",
      sourceChain: "stellar",
      destinationChain: "ethereum",
      user: stellarUserAddress,
      amount: usdcAmount,
      bridgeFee,
      netAmount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      estimatedArrivalTime: Date.now() + 15 * 60 * 1000, // ~15 min
    };

    this.bridgeTransfers.set(transfer.id, {
      ...transfer,
      retriesRemaining: 3,
    });

    this.logger.info(
      { transferId: transfer.id, status: transfer.status },
      "Bridge transfer initiated",
    );

    return transfer;
  }

  /**
   * Get quote for bridge transfer
   */
  async getBridgeQuote(
    amount: bigint,
    direction: "eth_to_stellar" | "stellar_to_eth",
  ): Promise<BridgeQuote> {
    const bridgeFee =
      (amount * BigInt(Math.floor(this.config.bridgeFeePercentage * 100))) /
      BigInt(10000);
    const netAmount = amount - bridgeFee;

    // Estimate based on direction
    const estimatedTime = direction === "eth_to_stellar" ? 10 * 60 : 15 * 60; // seconds

    return {
      amount,
      bridgeFee,
      netAmount,
      estimatedTime,
      slippagePercentage: 0.1, // 0.1% slippage buffer
    };
  }

  /**
   * Execute transfer via Axelar GMP
   */
  async executeAxelarTransfer(
    transferId: string,
    sourceChainTxHash: string,
  ): Promise<string> {
    const transfer = this.bridgeTransfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    this.logger.info(
      { transferId, sourceChainTxHash },
      "Executing Axelar transfer",
    );

    try {
      // Build GMP message payload
      const payload = this.encodeGMPPayload(transfer);

      // Send via Axelar API
      const axelarResponse = await axios.post(
        `${this.config.axelarApiUrl}/transfers`,
        {
          sourceChain:
            transfer.sourceChain === "ethereum" ? "ethereum" : "stellar",
          destinationChain:
            transfer.destinationChain === "ethereum" ? "ethereum" : "stellar",
          payload,
          amount: transfer.netAmount.toString(),
          gasLimit: "500000",
        },
      );

      const bridgeTxHash = axelarResponse.data.transactionHash;

      // Update transfer status
      transfer.status = "confirming";
      transfer.sourceChainTxHash = sourceChainTxHash;
      transfer.bridgeTxHash = bridgeTxHash;
      transfer.updatedAt = Date.now();

      this.logger.info(
        { transferId, bridgeTxHash },
        "Axelar transfer submitted",
      );

      return bridgeTxHash;
    } catch (error) {
      this.logger.error({ error, transferId }, "Axelar transfer failed");
      transfer.status = "failed";
      transfer.errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      transfer.updatedAt = Date.now();
      throw error;
    }
  }

  /**
   * Poll Axelar for transfer status
   */
  async pollTransferStatus(transferId: string): Promise<BridgeStatus> {
    const transfer = this.bridgeTransfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    if (!transfer.bridgeTxHash) {
      return transfer.status;
    }

    try {
      const response = await axios.get(
        `${this.config.axelarApiUrl}/transfers/${transfer.bridgeTxHash}`,
      );

      const axelarStatus = response.data.status;

      // Map Axelar status to our status
      if (axelarStatus === "executed") {
        transfer.status = "confirmed";
        transfer.destinationTxHash = response.data.destinationTxHash;
      } else if (axelarStatus === "failed") {
        transfer.status = "failed";
      }

      transfer.updatedAt = Date.now();

      return transfer.status;
    } catch (error) {
      this.logger.error(
        { error, transferId },
        "Failed to poll transfer status",
      );
      return transfer.status;
    }
  }

  /**
   * Retry failed transfer
   */
  async retryTransfer(transferId: string): Promise<void> {
    const transfer = this.bridgeTransfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    if (transfer.retriesRemaining <= 0) {
      throw new Error(`No retries remaining for transfer ${transferId}`);
    }

    this.logger.info(
      { transferId, retriesRemaining: transfer.retriesRemaining - 1 },
      "Retrying failed transfer",
    );

    transfer.retriesRemaining -= 1;
    transfer.status = "pending";
    transfer.lastRetryTime = Date.now();
    transfer.updatedAt = Date.now();
  }

  /**
   * Cancel pending transfer
   */
  async cancelTransfer(transferId: string): Promise<void> {
    const transfer = this.bridgeTransfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    if (transfer.status === "confirmed" || transfer.status === "failed") {
      throw new Error(`Cannot cancel transfer in status: ${transfer.status}`);
    }

    transfer.status = "cancelled";
    transfer.updatedAt = Date.now();

    this.logger.info({ transferId }, "Transfer cancelled");
  }

  /**
   * Get transfer status
   */
  getTransfer(transferId: string): BridgeTransfer | undefined {
    return this.bridgeTransfers.get(transferId);
  }

  /**
   * Verify Axelar relayer signature
   */
  async verifyAxelarSignature(
    message: string,
    signature: string,
    relayerAddress: string,
  ): Promise<boolean> {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === relayerAddress.toLowerCase();
    } catch (error) {
      this.logger.error({ error }, "Failed to verify signature");
      return false;
    }
  }

  /**
   * Encode GMP payload for Axelar
   */
  private encodeGMPPayload(transfer: BridgeTransfer): string {
    const payload = {
      version: 1,
      transferId: transfer.id,
      user: transfer.user,
      amount: transfer.netAmount.toString(),
      destinationChain: transfer.destinationChain,
      timestamp: Date.now(),
    };

    return Buffer.from(JSON.stringify(payload)).toString("hex");
  }

  /**
   * Get all pending transfers
   */
  getPendingTransfers(): BridgeTransfer[] {
    return Array.from(this.bridgeTransfers.values()).filter(
      (t) => t.status === "pending" || t.status === "confirming",
    );
  }

  /**
   * Get transfer statistics
   */
  getStatistics(): {
    totalTransfers: number;
    pendingTransfers: number;
    confirmedTransfers: number;
    failedTransfers: number;
    totalVolume: bigint;
  } {
    const transfers = Array.from(this.bridgeTransfers.values());
    const confirmed = transfers.filter((t) => t.status === "confirmed");
    const pending = transfers.filter(
      (t) => t.status === "pending" || t.status === "confirming",
    );
    const failed = transfers.filter((t) => t.status === "failed");

    const totalVolume = confirmed.reduce(
      (acc, t) => acc + t.netAmount,
      BigInt(0),
    );

    return {
      totalTransfers: transfers.length,
      pendingTransfers: pending.length,
      confirmedTransfers: confirmed.length,
      failedTransfers: failed.length,
      totalVolume,
    };
  }
}
