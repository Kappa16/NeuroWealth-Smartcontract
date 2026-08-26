import express from 'express';
import { Pool } from 'pg';
import { SorobanRpc } from '@stellar/stellar-sdk';
import logger from './logger';

const router = express.Router();
let dbPool: Pool | null = null;
let rpcServer: SorobanRpc.Server | null = null;

export function configureHealthChecks(pool: Pool, server: SorobanRpc.Server) {
  dbPool = pool;
  rpcServer = server;
}

router.get('/health', async (_req, res) => {
  const checks: Record<string, string> = {};

  // Database check
  try {
    if (dbPool) {
      await dbPool.query('SELECT 1');
      checks.database = 'ok';
    } else {
      checks.database = 'not_configured';
    }
  } catch {
    checks.database = 'error';
  }

  // Stellar RPC check
  try {
    if (rpcServer) {
      await rpcServer.getLatestLedger();
      checks.stellar_rpc = 'ok';
    } else {
      checks.stellar_rpc = 'not_configured';
    }
  } catch {
    checks.stellar_rpc = 'error';
  }

  const isHealthy = Object.values(checks).every((s) => s === 'ok' || s === 'not_configured');
  const status = isHealthy ? 200 : 503;

  res.status(status).json({
    status: isHealthy ? 'ok' : 'degraded',
    checks,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (_req, res) => {
  try {
    if (rpcServer) {
      await rpcServer.getLatestLedger();
    }
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false, error: 'Stellar RPC unreachable' });
  }
});

export default router;
