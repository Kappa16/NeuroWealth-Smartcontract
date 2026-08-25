'use client';

import React from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, ExternalLink } from 'lucide-react';
import { TransactionRecord } from '@/lib/database';

interface TransactionHistoryProps {
  transactions: TransactionRecord[];
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({ transactions }) => {
  if (transactions.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-center text-slate-400 text-sm">
        No transaction history found for this account.
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Transaction History</h3>
          <p className="text-xs text-slate-400">On-chain Soroban vault events</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Amount</th>
              <th className="py-3 px-4">Tx Hash</th>
              <th className="py-3 px-4">Date / Time</th>
              <th className="py-3 px-4 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
            {transactions.map((tx) => (
              <tr key={tx.id} className="hover:bg-slate-900/40 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    {tx.type === 'deposit' && (
                      <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                        <ArrowDownLeft size={14} />
                      </span>
                    )}
                    {tx.type === 'withdrawal' && (
                      <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
                        <ArrowUpRight size={14} />
                      </span>
                    )}
                    {tx.type === 'rebalance' && (
                      <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                        <RefreshCw size={14} />
                      </span>
                    )}
                    <span className="capitalize font-sans font-medium text-slate-200">{tx.type}</span>
                  </div>
                </td>
                <td className="py-3 px-4 font-semibold text-white">
                  {tx.amount.toLocaleString()} USDC
                </td>
                <td className="py-3 px-4 text-slate-400">
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 hover:text-emerald-400 transition-colors"
                  >
                    <span>{tx.txHash}</span>
                    <ExternalLink size={12} />
                  </a>
                </td>
                <td className="py-3 px-4 text-slate-400">{tx.timestamp}</td>
                <td className="py-3 px-4 text-right">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {tx.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
