'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface PortfolioEvent {
  type: 'deposit' | 'withdrawal' | 'rebalance' | 'yield';
  amount?: string;
  asset?: string;
  timestamp: number;
  ledger?: number;
  txHash?: string;
}

interface PortfolioState {
  balance: {
    idle: number;
    deployed: number;
    total: number;
  };
  yieldAccrual: {
    rate: number;
    earned24h: number;
    earnedTotal: number;
  };
  lastUpdate: number;
  isConnected: boolean;
  connectionType: 'websocket' | 'polling' | 'disconnected';
}

interface UseRealtimePortfolioOptions {
  wsUrl?: string;
  pollIntervalMs?: number;
  contractId?: string;
  accountAddress?: string;
}

const DEFAULT_POLL_INTERVAL = 10000;

export function useRealtimePortfolio(options: UseRealtimePortfolioOptions = {}) {
  const {
    wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001',
    pollIntervalMs = DEFAULT_POLL_INTERVAL,
    contractId,
    accountAddress,
  } = options;

  const [state, setState] = useState<PortfolioState>({
    balance: { idle: 0, deployed: 0, total: 0 },
    yieldAccrual: { rate: 0, earned24h: 0, earnedTotal: 0 },
    lastUpdate: Date.now(),
    isConnected: false,
    connectionType: 'disconnected',
  });

  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  const addEvent = useCallback((event: PortfolioEvent) => {
    setEvents(prev => [event, ...prev].slice(0, 100));
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Realtime] WebSocket connected');
        reconnectAttempts.current = 0;
        setState(prev => ({ ...prev, isConnected: true, connectionType: 'websocket' }));

        if (contractId) {
          ws.send(JSON.stringify({ action: 'subscribe', contractId }));
        }
        if (accountAddress) {
          ws.send(JSON.stringify({ action: 'subscribe_account', address: accountAddress }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'portfolio_update') {
            setState(prev => ({
              ...prev,
              balance: data.balance || prev.balance,
              yieldAccrual: data.yield || prev.yieldAccrual,
              lastUpdate: Date.now(),
            }));
          } else if (data.type === 'vault_event') {
            addEvent({
              type: data.eventType,
              amount: data.amount,
              asset: data.asset,
              timestamp: Date.now(),
              ledger: data.ledger,
              txHash: data.txHash,
            });
          }
        } catch (e) {
          console.error('[Realtime] Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[Realtime] WebSocket disconnected');
        setState(prev => ({ ...prev, isConnected: false, connectionType: 'disconnected' }));

        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
      };

      ws.onerror = (error) => {
        console.error('[Realtime] WebSocket error:', error);
        ws.close();
      };
    } catch (error) {
      console.error('[Realtime] Failed to connect WebSocket:', error);
      startPolling();
    }
  }, [wsUrl, contractId, accountAddress, addEvent]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;

    console.log('[Realtime] Falling back to polling');
    setState(prev => ({ ...prev, isConnected: true, connectionType: 'polling' }));

    const fetchPortfolio = async () => {
      try {
        const params = new URLSearchParams();
        if (contractId) params.set('contractId', contractId);
        if (accountAddress) params.set('address', accountAddress);

        const response = await fetch(`/api/portfolio?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch portfolio');

        const data = await response.json();
        setState(prev => ({
          ...prev,
          balance: data.balance || prev.balance,
          yieldAccrual: data.yield || prev.yieldAccrual,
          lastUpdate: Date.now(),
        }));
      } catch (error) {
        console.error('[Realtime] Polling error:', error);
      }
    };

    fetchPortfolio();
    pollRef.current = setInterval(fetchPortfolio, pollIntervalMs);
  }, [contractId, accountAddress, pollIntervalMs]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isConnected: false, connectionType: 'disconnected' }));
  }, []);

  useEffect(() => {
    connectWebSocket();
    return disconnect;
  }, [connectWebSocket, disconnect]);

  return {
    ...state,
    events,
    disconnect,
    reconnect: connectWebSocket,
  };
}
