-- Standalone PostgreSQL Database Schema Copy for NeuroWealth
-- Issue #470: User positions, transaction history, and yield performance

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stellar_address TEXT UNIQUE NOT NULL,
    phone_hash TEXT UNIQUE,
    strategy_preference TEXT NOT NULL DEFAULT 'balanced' CHECK (strategy_preference IN ('conservative', 'balanced', 'growth')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(30, 7) NOT NULL CHECK (amount > 0),
    shares NUMERIC(30, 7) NOT NULL CHECK (shares > 0),
    tx_hash TEXT UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(30, 7) NOT NULL CHECK (amount > 0),
    shares NUMERIC(30, 7) NOT NULL CHECK (shares > 0),
    tx_hash TEXT UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rebalances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    protocol TEXT NOT NULL CHECK (protocol IN ('blend', 'dex', 'none')),
    amount_moved NUMERIC(30, 7) NOT NULL,
    apy_before NUMERIC(6, 2) NOT NULL,
    apy_after NUMERIC(6, 2) NOT NULL,
    tx_hash TEXT UNIQUE NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS yield_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_assets NUMERIC(30, 7) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS earnings_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    daily_earnings NUMERIC(30, 7) NOT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_daily_earnings UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    table_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    record_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
