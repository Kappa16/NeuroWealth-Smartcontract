/**
 * Cross-chain bridge types
 */

export type BridgeChain = "stellar" | "ethereum";
export type BridgeDirection = "deposit" | "withdraw";
export type BridgeStatus =
  | "pending"
  | "confirming"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface BridgeConfig {
  // Stellar
  stellarRpcUrl: string;
  stellarNetworkPassphrase: string;
  stellarVaultContractId: string;
  stellarUsdcTokenId: string;

  // Ethereum
  ethereumRpcUrl: string;
  ethereumChainId: number;
  ethereumVaultContractAddress: string;
  ethereumUsdcTokenAddress: string;

  // Axelar
  axelarApiUrl: string;
  axelarChainName: string;
  axelarGasServiceAddress: string;

  // Bridge settings
  bridgeFeePercentage: number; // 0.5 = 0.5%
  minBridgeAmount: bigint;
  maxBridgeAmount: bigint;
}

export interface BridgeTransfer {
  id: string;
  status: BridgeStatus;
  direction: BridgeDirection;
  sourceChain: BridgeChain;
  destinationChain: BridgeChain;
  user: string;
  amount: bigint;
  bridgeFee: bigint;
  netAmount: bigint;
  sourceChainTxHash?: string;
  bridgeTxHash?: string;
  destinationTxHash?: string;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
  estimatedArrivalTime?: number;
}

export interface BridgeQuote {
  amount: bigint;
  bridgeFee: bigint;
  netAmount: bigint;
  estimatedTime: number; // seconds
  slippagePercentage: number;
}

export interface AxelarGMPMessage {
  messageId: string;
  sourceChain: string;
  destinationChain: string;
  sourceAddress: string;
  destinationAddress: string;
  payload: string;
  status: "pending" | "approved" | "executed" | "failed";
}

export interface BridgeEvent {
  type:
    | "deposit_initiated"
    | "withdraw_initiated"
    | "transfer_confirmed"
    | "transfer_failed"
    | "transfer_completed";
  bridgeTransferId: string;
  timestamp: number;
  details: Record<string, any>;
}

export interface StoredBridgeTransfer extends BridgeTransfer {
  retriesRemaining: number;
  lastRetryTime?: number;
}
