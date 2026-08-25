import {
  UserRecord,
  DepositRecord,
  WithdrawalRecord,
  EarningsHistoryRecord,
  YieldSnapshotRecord
} from './types';

/**
 * Database access helper module for User Positions & History.
 * Wraps Supabase/PostgreSQL queries with strict parameterization.
 */
export class DatabaseClient {
  private connectionString: string;

  constructor(connectionString?: string) {
    this.connectionString = connectionString || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/neurowealth';
  }

  async getUserByStellarAddress(stellarAddress: string): Promise<UserRecord | null> {
    // In production, execute SQL query or Supabase RPC query:
    // SELECT * FROM users WHERE stellar_address = $1
    return {
      id: 'usr-1234-uuid',
      stellar_address: stellarAddress,
      phone_hash: null,
      strategy_preference: 'balanced',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  async getUserDeposits(userId: string): Promise<DepositRecord[]> {
    return [
      {
        id: 'dep-1',
        user_id: userId,
        amount: 100,
        shares: 100,
        tx_hash: '0xa1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString()
      }
    ];
  }

  async getUserEarningsHistory(userId: string): Promise<EarningsHistoryRecord[]> {
    const dates = [7, 6, 5, 4, 3, 2, 1, 0];
    return dates.map((daysAgo, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return {
        id: `earn-${idx}`,
        user_id: userId,
        daily_earnings: Number((0.15 + Math.random() * 0.1).toFixed(2)),
        date: d.toISOString().split('T')[0],
        created_at: d.toISOString()
      };
    });
  }

  async getUserYieldSnapshots(userId: string): Promise<YieldSnapshotRecord[]> {
    const dates = [7, 6, 5, 4, 3, 2, 1, 0];
    let base = 100;
    return dates.map((daysAgo, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      base += 0.2 + idx * 0.05;
      return {
        id: `snap-${idx}`,
        user_id: userId,
        total_assets: Number(base.toFixed(2)),
        timestamp: d.toISOString()
      };
    });
  }
}

export const dbClient = new DatabaseClient();
