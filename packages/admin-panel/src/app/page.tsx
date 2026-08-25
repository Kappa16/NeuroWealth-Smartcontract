"use client";

import { useState, useEffect } from "react";
import { VaultClient } from "@neurowealth/vault-client";
import { useStore } from "@/lib/store";
import { getSorobanServer, NETWORKS, signWithFreighter } from "@/lib/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

import { WalletConnect } from "@/components/WalletConnect";
import { PauseControl } from "@/components/PauseControl";
import { CapsConfiguration } from "@/components/CapsConfiguration";
import { PoolConfiguration } from "@/components/PoolConfiguration";
import { RebalanceCooldown } from "@/components/RebalanceCooldown";
import { ApprovalTTL } from "@/components/ApprovalTTL";
import { OwnershipTransfer } from "@/components/OwnershipTransfer";
import { AgentManagement } from "@/components/AgentManagement";
import { ContractUpgrade } from "@/components/ContractUpgrade";

import { Settings, AlertCircle } from "lucide-react";

export default function AdminDashboard() {
  const {
    publicKey,
    isConnected,
    network,
    contractId,
    setIsAdmin,
    setContractId: storeSetContractId,
  } = useStore();
  const [client, setClient] = useState<VaultClient | null>(null);
  const [signer, setSigner] = useState<StellarSdk.Keypair | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [currentLedger, setCurrentLedger] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputContractId, setInputContractId] = useState(contractId || "");

  // Initialize client and check admin status
  useEffect(() => {
    if (!isConnected || !publicKey) return;

    const initClient = async () => {
      setLoading(true);
      setError(null);

      try {
        const effectiveContractId = inputContractId || contractId;
        if (!effectiveContractId) {
          setError("Contract ID not configured");
          setLoading(false);
          return;
        }

        storeSetContractId(effectiveContractId);

        const sorobanClient = new VaultClient({
          contractId: effectiveContractId,
          rpcUrl: NETWORKS[network].rpcUrl,
          networkPassphrase: NETWORKS[network].networkPassphrase,
        });

        setClient(sorobanClient);

        // Create a temporary keypair for queries (won't be used for signing)
        const tempKeypair = StellarSdk.Keypair.random();

        // Check owner
        try {
          const contractOwner = await sorobanClient.get_owner(
            tempKeypair.publicKey(),
          );
          setOwner(contractOwner);

          // Check if connected user is owner
          if (contractOwner === publicKey) {
            setIsAdmin(true);
          } else {
            setError(`Not the contract owner. Owner: ${contractOwner}`);
            setIsAdmin(false);
          }
        } catch (err) {
          setError(`Failed to verify contract owner: ${err}`);
        }

        // Get current ledger
        try {
          const server = getSorobanServer(network);
          const latestLedger = await server.getLatestLedger();
          setCurrentLedger(latestLedger.sequence);
        } catch (err) {
          console.warn("Failed to get current ledger:", err);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to initialize client",
        );
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    initClient();
  }, [isConnected, publicKey, network, contractId, inputContractId]);

  // Create signer when needed
  const createSigner = async () => {
    if (!isConnected || !publicKey) {
      setError("Wallet not connected");
      return null;
    }

    // For a real app, you'd use Freighter's signing method
    // For now, we'll use a placeholder that shows the architecture
    setError(
      "Note: Signing requires Freighter wallet integration. This is configured but requires user approval.",
    );
    return null;
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-4xl font-bold gradient-text mb-4">
              NeuroWealth Admin Panel
            </h1>
            <p className="text-slate-400 text-lg mb-12">
              Connect your wallet to manage the vault
            </p>
            <div className="max-w-md mx-auto">
              <WalletConnect />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="glass-effect border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold gradient-text flex items-center gap-2">
                <Settings size={32} />
                NeuroWealth Admin
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Network:{" "}
                <span className="text-emerald-400 capitalize">{network}</span>
              </p>
            </div>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Contract ID Configuration */}
        {!client && (
          <div className="mb-8 card">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <AlertCircle className="text-yellow-400" size={20} />
              Configure Contract Address
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputContractId}
                onChange={(e) => setInputContractId(e.target.value)}
                placeholder="Enter contract ID (starts with C...)"
                className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded text-slate-100 font-mono text-sm"
              />
              <button
                onClick={() => {
                  storeSetContractId(inputContractId);
                }}
                className="button-primary px-6 py-2"
              >
                Connect
              </button>
            </div>
            {process.env.NEXT_PUBLIC_CONTRACT_ID && (
              <p className="text-xs text-slate-500 mt-2">
                Using contract from env:{" "}
                {process.env.NEXT_PUBLIC_CONTRACT_ID.slice(0, 10)}...
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-700 rounded">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {loading && (
          <div className="mb-8 p-4 bg-blue-900/20 border border-blue-700 rounded">
            <p className="text-sm text-blue-300">
              Loading contract information...
            </p>
          </div>
        )}

        {client && owner && publicKey === owner ? (
          <div className="space-y-8">
            {/* Emergency Controls */}
            <section>
              <h2 className="text-2xl font-bold mb-4 text-emerald-400">
                Emergency Controls
              </h2>
              <PauseControl
                client={client}
                signer={StellarSdk.Keypair.random()}
              />
            </section>

            {/* Configuration */}
            <section>
              <h2 className="text-2xl font-bold mb-4 text-emerald-400">
                Configuration
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <CapsConfiguration
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                />
                <PoolConfiguration
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                />
              </div>
            </section>

            <section>
              <h2 className="text-2xl font-bold mb-4 text-emerald-400">
                Operational Settings
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <RebalanceCooldown
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                />
                <ApprovalTTL
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                />
              </div>
            </section>

            {/* Access Control */}
            <section>
              <h2 className="text-2xl font-bold mb-4 text-emerald-400">
                Access Control
              </h2>
              <div className="grid grid-cols-1 gap-8">
                <OwnershipTransfer
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                />
              </div>
            </section>

            {/* Agents & Upgrades */}
            <section>
              <h2 className="text-2xl font-bold mb-4 text-emerald-400">
                Advanced Management
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <AgentManagement
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                  currentLedger={currentLedger}
                />
                <ContractUpgrade
                  client={client}
                  signer={StellarSdk.Keypair.random()}
                  currentLedger={currentLedger}
                />
              </div>
            </section>

            {/* Info Footer */}
            <section className="card bg-slate-800/50">
              <h3 className="text-lg font-bold mb-2">Contract Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-slate-400">Owner</div>
                  <div className="font-mono text-emerald-400 break-all text-xs">
                    {owner}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Current Ledger</div>
                  <div className="text-emerald-400">{currentLedger}</div>
                </div>
              </div>
            </section>
          </div>
        ) : client && owner && publicKey !== owner ? (
          <div className="card border-2 border-red-600">
            <h3 className="text-lg font-bold text-red-400 mb-2">
              Access Denied
            </h3>
            <p className="text-sm text-slate-300">
              You are not the contract owner. Only the owner can access this
              admin panel.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Owner: <span className="font-mono">{owner}</span>
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
