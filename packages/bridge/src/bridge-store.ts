/**
 * Persistent storage for bridge transfers (database abstraction)
 */

import pino from "pino";
import { StoredBridgeTransfer, BridgeTransfer, BridgeStatus } from "./types";

export interface BridgeStore {
  save(transfer: StoredBridgeTransfer): Promise<void>;
  get(transferId: string): Promise<StoredBridgeTransfer | null>;
  getPending(): Promise<StoredBridgeTransfer[]>;
  getByUser(userAddress: string): Promise<StoredBridgeTransfer[]>;
  update(
    transferId: string,
    updates: Partial<StoredBridgeTransfer>,
  ): Promise<void>;
  delete(transferId: string): Promise<void>;
}

/**
 * In-memory store for development/testing
 * Replace with PostgreSQL/Supabase in production
 */
export class InMemoryBridgeStore implements BridgeStore {
  private logger = pino();
  private transfers: Map<string, StoredBridgeTransfer> = new Map();

  async save(transfer: StoredBridgeTransfer): Promise<void> {
    this.transfers.set(transfer.id, transfer);
    this.logger.debug({ transferId: transfer.id }, "Transfer saved to store");
  }

  async get(transferId: string): Promise<StoredBridgeTransfer | null> {
    return this.transfers.get(transferId) || null;
  }

  async getPending(): Promise<StoredBridgeTransfer[]> {
    return Array.from(this.transfers.values()).filter(
      (t) => t.status === "pending" || t.status === "confirming",
    );
  }

  async getByUser(userAddress: string): Promise<StoredBridgeTransfer[]> {
    return Array.from(this.transfers.values()).filter(
      (t) => t.user.toLowerCase() === userAddress.toLowerCase(),
    );
  }

  async update(
    transferId: string,
    updates: Partial<StoredBridgeTransfer>,
  ): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    const updated = { ...transfer, ...updates, updatedAt: Date.now() };
    this.transfers.set(transferId, updated);
    this.logger.debug({ transferId }, "Transfer updated in store");
  }

  async delete(transferId: string): Promise<void> {
    this.transfers.delete(transferId);
    this.logger.debug({ transferId }, "Transfer deleted from store");
  }
}

/**
 * SQL-based store template (Supabase/PostgreSQL)
 * Implement this for production
 */
export class SqlBridgeStore implements BridgeStore {
  private logger = pino();

  constructor(private dbClient: any) {} // Replace with actual DB client type

  async save(transfer: StoredBridgeTransfer): Promise<void> {
    const { data, error } = await this.dbClient
      .from("bridge_transfers")
      .insert([transfer]);

    if (error) {
      this.logger.error({ error }, "Failed to save transfer");
      throw error;
    }

    this.logger.debug(
      { transferId: transfer.id },
      "Transfer saved to database",
    );
  }

  async get(transferId: string): Promise<StoredBridgeTransfer | null> {
    const { data, error } = await this.dbClient
      .from("bridge_transfers")
      .select("*")
      .eq("id", transferId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    return data || null;
  }

  async getPending(): Promise<StoredBridgeTransfer[]> {
    const { data, error } = await this.dbClient
      .from("bridge_transfers")
      .select("*")
      .in("status", ["pending", "confirming"]);

    if (error) {
      throw error;
    }

    return data || [];
  }

  async getByUser(userAddress: string): Promise<StoredBridgeTransfer[]> {
    const { data, error } = await this.dbClient
      .from("bridge_transfers")
      .select("*")
      .ilike("user", userAddress);

    if (error) {
      throw error;
    }

    return data || [];
  }

  async update(
    transferId: string,
    updates: Partial<StoredBridgeTransfer>,
  ): Promise<void> {
    const { error } = await this.dbClient
      .from("bridge_transfers")
      .update({ ...updates, updatedAt: Date.now() })
      .eq("id", transferId);

    if (error) {
      this.logger.error({ error }, "Failed to update transfer");
      throw error;
    }

    this.logger.debug({ transferId }, "Transfer updated in database");
  }

  async delete(transferId: string): Promise<void> {
    const { error } = await this.dbClient
      .from("bridge_transfers")
      .delete()
      .eq("id", transferId);

    if (error) {
      this.logger.error({ error }, "Failed to delete transfer");
      throw error;
    }

    this.logger.debug({ transferId }, "Transfer deleted from database");
  }
}
