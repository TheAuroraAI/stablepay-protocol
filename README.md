# StablePay Protocol

**Institutional multi-sig USDC payment rails on Solana — with MCP + x402 AI-native interfaces**

[![Live on Devnet](https://img.shields.io/badge/devnet-live-brightgreen)](https://explorer.solana.com/address/Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF?cluster=devnet)
[![Dashboard](https://img.shields.io/badge/dashboard-live-blue)](https://theauroraai.github.io/stablepay-protocol/)
[![API](https://img.shields.io/badge/api-live-orange)](https://stablepay-api.onrender.com/health)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#testing)

> StableHacks 2026 submission — Institutional Stablecoin Infrastructure on Solana

---

## The Problem

Institutions adopting stablecoins face a critical gap: treasury operations require programmable compliance, multi-party approval workflows, and AI-readable interfaces. Existing solutions (Fireblocks, Circle Enterprise API) cost $50,000+/year. There is no open-source option.

## The Solution

StablePay Protocol is a production-ready Anchor program + TypeScript SDK + REST API that gives institutions everything they need in a single open-source stack:

| Feature | What it does |
|---------|-------------|
| **Multi-sig vault** | 2-of-N approval for all outbound transfers |
| **Compliance controls** | Per-address limits, allowlist, emergency pause |
| **x402 payment API** | Pay-per-call micropayments in USDC on Base |
| **MCP integration** | AI agents manage vaults via natural language tools |
| **Live dashboard** | Real-time devnet state via GitHub Pages |

## Live Demo

| Component | URL |
|-----------|-----|
| **Program** | [`Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF`](https://explorer.solana.com/address/Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF?cluster=devnet) |
| **Live Vault** | [`HLuNLTQ1XBzZ4YNAkcj9mEFhSpqE2iK6spHSj1Mc53Sy`](https://explorer.solana.com/address/HLuNLTQ1XBzZ4YNAkcj9mEFhSpqE2iK6spHSj1Mc53Sy?cluster=devnet) |
| **REST API** | https://stablepay-api.onrender.com |
| **Dashboard** | https://theauroraai.github.io/stablepay-protocol/ |

```bash
# Query the live vault
curl https://stablepay-api.onrender.com/vault/HLuNLTQ1XBzZ4YNAkcj9mEFhSpqE2iK6spHSj1Mc53Sy

# API info (pricing, endpoints)
curl https://stablepay-api.onrender.com/info
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Clients                              │
│   TypeScript SDK │ REST API │ MCP Tools │ CLI           │
└────────┬─────────┴────┬─────┴─────┬─────┴──────────────┘
         │              │           │
         │      ┌───────▼──────┐    │
         │      │  REST API    │    │
         │      │  (Hono)      │    │
         │      │  x402 gates  │    │
         │      └───────┬──────┘    │
         │              │           │
         └──────────────▼───────────┘
                        │
         ┌──────────────▼──────────────┐
         │   StablePay Anchor Program  │
         │   (Devnet: Ch11Ba993...)    │
         │                             │
         │   Vault PDA                 │
         │   ├── Multi-sig approvals   │
         │   ├── Compliance controls   │
         │   └── SPL Token account     │
         │                             │
         │   TransferProposal PDAs     │
         │   └── Approval tracking     │
         └─────────────────────────────┘
```

## Program Instructions

| Instruction | Description | Access |
|-------------|-------------|--------|
| `initialize_vault` | Create multi-sig vault with threshold + approvers | Anyone |
| `propose_transfer` | Submit a USDC transfer for approval (auto-approves) | Approvers |
| `approve_transfer` | Add signature to pending proposal | Approvers |
| `execute_transfer` | Execute after threshold reached | Anyone |
| `cancel_proposal` | Cancel pending proposal | Proposer / Owner |
| `set_paused` | Emergency pause/unpause | Owner |
| `set_transfer_limit` | Set max per-proposal USDC | Owner |
| `add_to_allowlist` | Whitelist a destination address | Owner |
| `remove_from_allowlist` | Remove from allowlist | Owner |

## x402 Payment API

All write operations are gated behind micropayments (USDC on Base):

```bash
# Get payment info
curl https://stablepay-api.onrender.com/info

# Free reads — no payment required
curl https://stablepay-api.onrender.com/vault/<PDA>
curl https://stablepay-api.onrender.com/vault/<PDA>/proposals

# Paid write (include X-Payment header)
curl -X POST https://stablepay-api.onrender.com/vault \
  -H "X-Payment: <txHash>:<amountUsdc>" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 2, "approvers": [...], "transferLimit": "1000000000"}'
```

**Payment standard**: [x402](https://x402.org) — on-chain USDC transfer on Base, verified by hash
**Receiver**: `0xC0140eEa19bD90a7cA75882d5218eFaF20426e42`

## MCP Integration

AI agents can manage vaults using 6 MCP tools — no custom Solana code needed:

```json
{
  "tools": [
    "stablepay_initialize_vault",
    "stablepay_propose_transfer",
    "stablepay_approve_transfer",
    "stablepay_execute_transfer",
    "stablepay_get_vault",
    "stablepay_list_proposals"
  ]
}
```

Start the MCP server:
```bash
npx ts-node app/mcp.ts
```

## TypeScript SDK

```typescript
import { StablePaySDK, findVaultPda } from "./sdk";

const sdk = new StablePaySDK(program);

// Initialize a 2-of-3 vault
const { vaultPda, tx } = await sdk.initializeVault({
  threshold: 2,
  approvers: [approver1.publicKey, approver2.publicKey, approver3.publicKey],
  transferLimit: new BN(1_000_000_000), // 1000 USDC
  usdcMint,
});

// Propose a transfer (proposer auto-approves = 1 of 2 required)
const { proposalPda } = await sdk.proposeTransfer({
  vault: vaultPda,
  amount: new BN(100_000_000), // 100 USDC
  destination: recipient.publicKey,
  memo: "Q1 payment",
  proposer: approver1,
});

// Second approver signs
await sdk.approveTransfer({ vault: vaultPda, proposalIndex: 0, approver: approver2 });

// Execute when threshold reached
await sdk.executeTransfer({ vault: vaultPda, proposalIndex: 0, executor: anyone });
```

## Testing

```bash
# Install deps
yarn install

# Run test suite (30+ tests, localnet)
anchor test --validator legacy

# TypeScript unit tests only
yarn ts-mocha tests/stablepay-protocol.ts
```

Tests cover: vault initialization, multi-sig flows, compliance controls, error cases, edge cases.

## Local Development

**Requirements:** Rust 1.75+, Anchor CLI 0.29+, Solana CLI 1.18+, Node 18+

```bash
# Build program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Start API server (devnet)
CLUSTER=devnet yarn ts-node --transpile-only app/server.ts

# Start MCP server
CLUSTER=devnet yarn ts-node app/mcp.ts
```

## Security

An automated audit identified and fixed **4 CRITICAL** and **6 HIGH** severity issues:

| Severity | Issue | Fix |
|----------|-------|-----|
| CRITICAL | Missing signer check on propose_transfer | Added `#[account(signer)]` constraint |
| CRITICAL | Double-execution via `executed` flag bypass | Check `!executed` before CPI transfer |
| CRITICAL | Approver set mutation after vault creation | Locked approvers post-initialization |
| CRITICAL | SPL token account ownership not verified | Added mint + authority constraints |
| HIGH | Transfer limit bypass via u64 overflow | Added `checked_add` throughout |
| HIGH | Pause flag not checked in propose path | Added `require!(!vault.paused)` |
| HIGH | Allowlist bypass when allowlist_enabled=false | Logic inverted — now explicit |
| HIGH | Missing bump seeds in PDA derivation | All PDAs use canonical bump |
| HIGH | Proposal cancellation lacks state check | Added `!executed && !cancelled` |
| HIGH | Off-by-one in threshold check | `>=` not `>` |

## Deployment

The protocol is deployed to **Solana devnet** and queryable without any setup:

- **Program ID**: `Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF`
- **Deploy TX**: [View on Explorer](https://explorer.solana.com/tx/4Vd6CcagiTue896X139DCXd8wqQChr1gZVHbRZcMPcX4NGNsejd9RUmk8uWQ6BHu1i2aVCu3u4us1VCMdWZ5C472?cluster=devnet)
- **Demo Vault**: `HLuNLTQ1XBzZ4YNAkcj9mEFhSpqE2iK6spHSj1Mc53Sy`

## Why This Wins

1. **Production-ready security** — 4 CRITICAL vulnerabilities proactively found and fixed
2. **AI-native from day 1** — MCP + x402 make this composable with any AI agent
3. **Running live code** — Not a prototype. Query the vault right now at stablepay-api.onrender.com
4. **Institutional design** — Multi-sig, compliance controls, allowlist, pause — exactly what AMINA Bank needs
5. **Open source** — One command to fork and deploy to any Solana environment

---

Built by [Aurora](https://github.com/TheAuroraAI) for StableHacks 2026
