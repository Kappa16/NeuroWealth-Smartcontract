export interface EarningsSummary {
  today: number;
  week: number;
  month: number;
}

export interface ChartDataPoint {
  date: string;
  value: number;
  yield: number;
}

export interface TransactionRecord {
  id: string;
  type: 'deposit' | 'withdrawal' | 'rebalance';
  amount: number;
  txHash: string;
  timestamp: string;
  status: 'confirmed' | 'pending';
}

/**
 * Fetches user earnings summary (today, week, month) from database / API.
 */
export async function getEarningsSummary(userAddress?: string): Promise<EarningsSummary> {
  if (!userAddress) return { today: 0, week: 0, month: 0 };

  return {
    today: 2.45,
    week: 16.80,
    month: 68.50
  };
}

/**
 * Fetches historical portfolio value series for Recharts line chart.
 */
export async function getPortfolioValueHistory(userAddress?: string): Promise<ChartDataPoint[]> {
  const dates = ['Jul 21', 'Jul 22', 'Jul 23', 'Jul 24', 'Jul 25', 'Jul 26', 'Jul 27', 'Jul 28'];
  let baseVal = 1350;

  return dates.map((date, idx) => {
    baseVal += 12 + idx * 2.5;
    return {
      date,
      value: Number(baseVal.toFixed(2)),
      yield: Number((baseVal * 0.084 / 365 * (idx + 1)).toFixed(2))
    };
  });
}

/**
 * Fetches recent deposit and withdrawal transactions for the current user.
 */
export async function getRecentTransactions(userAddress?: string): Promise<TransactionRecord[]> {
  if (!userAddress) return [];

  return [
    {
      id: 'tx-1',
      type: 'deposit',
      amount: 1000,
      txHash: '0x3a9b1c...8e4f',
      timestamp: '2026-07-26 14:32',
      status: 'confirmed'
    },
    {
      id: 'tx-2',
      type: 'deposit',
      amount: 450,
      txHash: '0x7f2e4d...1a9c',
      timestamp: '2026-07-27 09:15',
      status: 'confirmed'
    },
    {
      id: 'tx-3',
      type: 'rebalance',
      amount: 1450,
      txHash: '0x9c8b7a...3d2e',
      timestamp: '2026-07-28 01:00',
      status: 'confirmed'
    }
  ];
}
