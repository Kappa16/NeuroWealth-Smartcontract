import { Keypair } from '@stellar/stellar-sdk';
import { encryptSecretKey, decryptSecretKey } from './cryptoUtils';

export interface UserWallet {
  publicKey: string;
  encryptedSecret: {
    encryptedData: string;
    iv: string;
    tag: string;
  };
  createdAt: number;
}

// In-memory store for custodial wallets keyed by phone hash (in production backed by DB)
const userWallets = new Map<string, UserWallet>();

/**
 * Creates a new custodial Stellar keypair for a verified user and encrypts secret key.
 */
export function createCustodialWallet(phoneHash: string): UserWallet {
  const pair = Keypair.random();
  const publicKey = pair.publicKey();
  const secretKey = pair.secret();

  const encryptedSecret = encryptSecretKey(secretKey);

  const wallet: UserWallet = {
    publicKey,
    encryptedSecret,
    createdAt: Date.now()
  };

  userWallets.set(phoneHash, wallet);
  return wallet;
}

/**
 * Retrieves a user's wallet info (public key and encrypted secret).
 */
export function getWallet(phoneHash: string): UserWallet | undefined {
  return userWallets.get(phoneHash);
}

/**
 * Decrypts secret key for transaction execution. Key is never saved in plaintext or output to chat.
 */
export function getDecryptedSecretKey(phoneHash: string): string | null {
  const wallet = userWallets.get(phoneHash);
  if (!wallet) return null;

  return decryptSecretKey(
    wallet.encryptedSecret.encryptedData,
    wallet.encryptedSecret.iv,
    wallet.encryptedSecret.tag
  );
}
