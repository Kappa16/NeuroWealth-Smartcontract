"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { connectFreighter, NETWORKS } from "@/lib/stellar";
import { Wallet, LogOut } from "lucide-react";

export function WalletConnect() {
  const {
    publicKey,
    isConnected,
    network,
    setPublicKey,
    setConnected,
    disconnect,
    setNetwork,
  } = useStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);

    try {
      const { publicKey: key } = await connectFreighter(network);
      setPublicKey(key);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setError(null);
  };

  const displayKey = publicKey
    ? `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}`
    : "";

  if (isConnected && publicKey) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-end">
          <div className="text-sm text-slate-400">Connected</div>
          <div className="text-sm font-mono text-emerald-400">{displayKey}</div>
          <div className="text-xs text-slate-500 capitalize">{network}</div>
        </div>
        <button
          onClick={handleDisconnect}
          className="button-secondary px-3 py-2 flex items-center gap-2"
        >
          <LogOut size={16} />
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <select
        value={network}
        onChange={(e) => setNetwork(e.target.value as typeof network)}
        className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 hover:border-slate-600 transition-colors"
      >
        {Object.keys(NETWORKS).map((net) => (
          <option key={net} value={net} className="bg-slate-900">
            {net.charAt(0).toUpperCase() + net.slice(1)}
          </option>
        ))}
      </select>

      <button
        onClick={handleConnect}
        disabled={loading}
        className="button-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Wallet size={16} />
        {loading ? "Connecting..." : "Connect Wallet"}
      </button>

      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>
  );
}
