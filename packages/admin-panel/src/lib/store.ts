import { create } from "zustand";
import { NetworkType } from "./stellar";

interface WalletState {
  publicKey: string | null;
  isConnected: boolean;
  network: NetworkType;
  contractId: string;
}

interface AppState extends WalletState {
  // Wallet actions
  setPublicKey: (key: string) => void;
  setConnected: (connected: boolean) => void;
  setNetwork: (network: NetworkType) => void;
  setContractId: (id: string) => void;
  disconnect: () => void;

  // Admin state
  isAdmin: boolean;
  setIsAdmin: (isAdmin: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  // Wallet state
  publicKey: null,
  isConnected: false,
  network: "testnet",
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "",
  isAdmin: false,

  // Wallet actions
  setPublicKey: (key) => set({ publicKey: key }),
  setConnected: (connected) => set({ isConnected: connected }),
  setNetwork: (network) => set({ network }),
  setContractId: (id) => set({ contractId: id }),
  disconnect: () =>
    set({
      publicKey: null,
      isConnected: false,
      isAdmin: false,
    }),

  // Admin actions
  setIsAdmin: (isAdmin) => set({ isAdmin }),
}));
