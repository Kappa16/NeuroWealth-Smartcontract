# Admin Panel Deployment Guide

## Prerequisites

- Node.js 18+ and npm
- Stellar contract address (from vault deployment)
- Freighter wallet extension installed in browser
- Valid RPC endpoint (testnet/mainnet/devnet)

## Local Development

### 1. Install Dependencies

```bash
cd packages/admin-panel
npm install
```

### 2. Configure Environment

Create `.env.local`:

```bash
NEXT_PUBLIC_CONTRACT_ID=C1234567890abcdef...  # Replace with your contract ID
```

### 3. Run Development Server

```bash
npm run dev
```

Open http://localhost:3000

### 4. Test Admin Functions

1. Click "Connect Wallet"
2. Select network (testnet/mainnet/devnet)
3. Approve in Freighter
4. Enter contract address
5. All admin controls appear if you're the owner

## Production Deployment

### Option 1: Vercel (Recommended)

```bash
# 1. Push to GitHub
git add packages/admin-panel
git commit -m "Add admin panel"
git push -u origin admin-panel-feature

# 2. Connect repo to Vercel
# - Import from GitHub
# - Root directory: packages/admin-panel
# - Build: npm run build
# - Start: npm start

# 3. Set environment variables in Vercel dashboard
# - NEXT_PUBLIC_CONTRACT_ID=C...

# 4. Deploy
vercel deploy --prod
```

### Option 2: Self-Hosted (Docker)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/admin-panel ./packages/admin-panel
COPY packages/vault-client ./packages/vault-client

WORKDIR /app/packages/admin-panel

# Install dependencies
RUN npm install

# Build
RUN npm run build

# Expose port
EXPOSE 3000

# Start
CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t neurowealth-admin .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_CONTRACT_ID=C... \
  neurowealth-admin
```

### Option 3: Netlify

```bash
# 1. Create netlify.toml
cat > packages/admin-panel/netlify.toml << EOF
[build]
  command = "npm run build"
  functions = "out"
  publish = ".next"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[env]
  [env.production]
    NEXT_PUBLIC_CONTRACT_ID = "C..."
EOF

# 2. Deploy
netlify deploy --prod
```

## Security Checklist

Before going to production:

- [ ] Contract ID is correct for target network
- [ ] Owner keypair is secure and backed up
- [ ] Freighter wallet is installed on deployment machine
- [ ] HTTPS enabled (all hosts provide this by default)
- [ ] Contract access control verified (owner checks work)
- [ ] Test pause/unpause on testnet first
- [ ] Test caps configuration on testnet
- [ ] Test ownership transfer flow on testnet
- [ ] Document all admin procedures
- [ ] Set up monitoring/alerting for contract events

## Testnet Deployment Flow

```
1. Deploy contract to testnet
2. Note contract address from deployment output
3. Set NEXT_PUBLIC_CONTRACT_ID in .env.local
4. Run: npm run dev
5. Connect with testnet account (Freighter)
6. Test each admin function
7. Verify contract events emitted
8. Check event indexing works
9. Document any issues
10. Move to mainnet only when fully tested
```

## Mainnet Security

### Pre-Deployment Verification

```bash
# 1. Verify contract on Soroban explorer
# https://explorer.soroban.stellar.org/?network=mainnet

# 2. Verify owner keypair
# - Use hardware wallet (Ledger) if possible
# - OR: Air-gapped cold storage
# - NEVER: Store in env vars in production

# 3. Verify RPC endpoint
# - Use official Soroban RPC
# - https://soroban.stellar.org (mainnet)

# 4. Test operations on testnet mirror first
```

### Admin Multi-Sig Setup (Recommended)

For mainnet, consider using multi-sig for owner account:

1. Create Stellar multi-sig account (requires 2-of-3 approvals)
2. Transfer contract ownership to multi-sig
3. Use Freighter with multi-sig account
4. All admin operations require multiple signatures

## Monitoring & Alerts

### Set Up Event Monitoring

```typescript
// Example: Listen for pause events
const listener = new VaultEventListener({
  contractId: "C...",
  server: sorobanServer,
  networkPassphrase: Networks.PUBLIC,
});

listener.onPause((event) => {
  // Alert: Vault was paused
  console.error("ALERT: Vault paused by", event.admin);
  // Send notification (Slack, PagerDuty, etc.)
});
```

### Recommended Alerts

- Emergency pause/unpause
- TVL cap changes
- Agent update initiations
- Upgrade schedules
- Ownership transfer attempts
- Failed transactions

## Troubleshooting

### "Contract ID not configured"

```bash
# Fix: Set NEXT_PUBLIC_CONTRACT_ID
echo "NEXT_PUBLIC_CONTRACT_ID=C..." > .env.local
npm run dev
```

### "Not the contract owner"

```bash
# Fix: Connect with the owner account in Freighter
# OR: Transfer ownership if you have a new owner
```

### "Transaction not confirmed"

```bash
# 1. Check network connectivity
# 2. Verify contract address is correct
# 3. Check Soroban RPC status
# 4. Try again with longer timeout
```

### Freighter Not Signing

```bash
# 1. Ensure Freighter is installed
# 2. Ensure network matches Freighter setting
# 3. Check browser console for errors
# 4. Restart browser
```

## Rollback Procedure

If admin panel needs to be disabled:

1. Update DNS/deployment to remove admin URL
2. Pause contract via deployed admin panel instance (before removing)
3. Delete environment variables from hosting platform
4. Archive GitHub branch (don't delete)

## Support & Maintenance

### Regular Checks

- [ ] Test admin operations weekly
- [ ] Verify Freighter compatibility after updates
- [ ] Monitor contract event stream
- [ ] Review transaction history
- [ ] Backup owner keypair securely

### Upgrade Procedure

```bash
# 1. Update dependencies
npm update

# 2. Test locally
npm run dev

# 3. Deploy to staging
vercel deploy

# 4. Test on testnet
# 5. Deploy to production
vercel deploy --prod
```

## Contact & Escalation

For production issues:

1. Check deployment logs
2. Verify contract state via explorer
3. Check RPC status
4. Contact Stellar support if RPC issue
5. Review contract access control if auth issue
