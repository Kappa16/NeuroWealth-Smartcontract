import {
  isConnected as checkFreighterConnected,
  getPublicKey as getFreighterPublicKey,
  signTransaction as signFreighterTx
} from '@stellar/freighter-api';

export interface FreighterWalletState {
  isConnected: boolean;
  publicKey: string | null;
  error: string | null;
}

/**
 * Checks if Freighter extension is installed in the user's browser.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  try {
    return await checkFreighterConnected();
  } catch (err) {
    return false;
  }
}

/**
 * Requests wallet connection from Freighter and returns the active public key.
 * Non-custodial signing model - private keys never enter web app.
 */
export async function connectFreighterWallet(): Promise<string | null> {
  try {
    const installed = await isFreighterInstalled();
    if (!installed) {
      alert('Freighter wallet extension is not installed. Please install Freighter to connect.');
      return null;
    }

    const key = await getFreighterPublicKey();
    return key || null;
  } catch (err: any) {
    console.error('Failed to connect Freighter wallet:', err);
    return null;
  }
}

/**
 * Signs a XDR transaction string using Freighter extension.
 */
export async function signWithFreighter(xdr: string, networkPassphrase?: string): Promise<string | null> {
  try {
    const signedXdr = await signFreighterTx(xdr, {
      networkPassphrase: networkPassphrase || 'Test SDF Network ; September 2015'
    });
    return signedXdr;
  } catch (err) {
    console.error('User rejected or failed transaction signing:', err);
    return null;
  }
}
