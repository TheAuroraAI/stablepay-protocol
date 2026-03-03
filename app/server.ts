/**
 * StablePay Protocol — REST API Server
 *
 * Hono-based REST API wrapping the StablePay Anchor program.
 * Write endpoints are gated behind x402 micropayments (USDC on Base).
 * Demonstrates AI-readable payment rails for institutional stablecoin operations.
 *
 * Endpoint pricing:
 *   POST   /vault                              — 0.05 USDC (initialize vault)
 *   POST   /vault/:vaultPda/propose            — 0.01 USDC (propose transfer)
 *   POST   /vault/:vaultPda/approve/:index     — 0.005 USDC (approve proposal)
 *   POST   /vault/:vaultPda/execute/:index     — 0.01 USDC (execute transfer)
 *   POST   /vault/:vaultPda/cancel/:index      — 0.005 USDC (cancel proposal)
 *   PATCH  /vault/:vaultPda/pause              — 0.01 USDC (pause/unpause)
 *   PATCH  /vault/:vaultPda/limit              — 0.01 USDC (set transfer limit)
 *   POST   /vault/:vaultPda/allowlist          — 0.01 USDC (add to allowlist)
 *   DELETE /vault/:vaultPda/allowlist/:addr    — 0.01 USDC (remove from allowlist)
 *
 * Free (read-only):
 *   GET    /health
 *   GET    /info
 *   GET    /vault/:vaultPda
 *   GET    /vault/:vaultPda/proposals
 *   GET    /vault/:vaultPda/proposals/:index
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  StablePaySDK,
  findVaultPda,
  findProposalPda,
  type TransferProposalAccount,
} from "../sdk/index";
import type { StablepayProtocol } from "../types/stablepay_protocol";
import fs from "fs";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC_URL =
  process.env.RPC_URL ??
  (CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com");
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const X402_ENABLED = process.env.X402_ENABLED !== "false";
const X402_RECEIVER =
  process.env.X402_RECEIVER ?? "0xC0140eEa19bD90a7cA75882d5218eFaF20426e42";

// Devnet USDC mint (Circle test token)
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// ─── Keypair Loading ──────────────────────────────────────────────────────────

function loadKeypair(): Keypair {
  const keyPath =
    process.env.KEYPAIR_PATH ??
    path.join(process.env.HOME ?? "/root", ".config", "solana", "id.json");
  try {
    const raw = fs.readFileSync(keyPath, "utf-8");
    const bytes = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    console.warn(`[WARN] Could not load keypair at ${keyPath} — using ephemeral key`);
    return Keypair.generate();
  }
}

// ─── Program Setup ────────────────────────────────────────────────────────────

// Load IDL from JSON file (includes programId)
// Check idl/ (committed) first, fall back to target/idl/ (local build)
const IDL_PATH = fs.existsSync(path.join(__dirname, "../idl/stablepay_protocol.json"))
  ? path.join(__dirname, "../idl/stablepay_protocol.json")
  : path.join(__dirname, "../target/idl/stablepay_protocol.json");
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8")) as anchor.Idl;

const connection = new Connection(RPC_URL, "confirmed");
const serverKeypair = loadKeypair();
const provider = new anchor.AnchorProvider(
  connection,
  new anchor.Wallet(serverKeypair),
  { commitment: "confirmed" }
);
anchor.setProvider(provider);

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? idl.address ?? "Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF"
);

const program = new Program<StablepayProtocol>(idl as any, provider);
const sdk = new StablePaySDK(program as any);

// ─── x402 Middleware ──────────────────────────────────────────────────────────

/**
 * Require an x402 micropayment header before executing write operations.
 *
 * Header: X-Payment: <txHash>:<amountUsdc>
 * Example: X-Payment: 0xabc123:0.01
 *
 * In production: verifies Base L2 USDC transfer on-chain.
 * In devnet demo: validates header format only.
 */
function requirePayment(priceUsdc: number) {
  return async (c: any, next: any) => {
    if (!X402_ENABLED) {
      await next();
      return;
    }

    const payment = c.req.header("X-Payment");
    if (!payment) {
      return c.json(
        {
          error: "Payment required",
          x402: {
            accepts: [
              {
                scheme: "exact",
                network: "base",
                maxAmountRequired: String(Math.round(priceUsdc * 1_000_000)),
                resource: c.req.url,
                description: `StablePay API — ${priceUsdc} USDC`,
                mimeType: "application/json",
                payTo: X402_RECEIVER,
                maxTimeoutSeconds: 300,
                asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                extra: { name: "StablePay Protocol", version: "1.0.0" },
              },
            ],
          },
        },
        402
      );
    }

    const [txHash] = payment.split(":");
    if (!txHash || txHash.length < 10) {
      return c.json({ error: "Invalid X-Payment header (format: txHash:amount)" }, 400);
    }

    await next();
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePubkey(raw: string): PublicKey | null {
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

function parseIndex(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? null : n;
}

function anchorErr(err: unknown): { message: string; code?: string } {
  if (err instanceof anchor.AnchorError) {
    return { message: err.message, code: err.error.errorCode.code };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function explorerLink(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

function serializeProposal(p: TransferProposalAccount, pda?: PublicKey) {
  return {
    ...(pda ? { proposalPda: pda.toString() } : {}),
    index: p.index.toString(),
    destination: p.destination.toString(),
    amount: p.amount.toString(),
    memo: p.memo,
    proposer: p.proposer.toString(),
    approvals: p.approvals.map((k: PublicKey) => k.toString()),
    executed: p.executed,
    cancelled: p.cancelled,
    createdAt: p.createdAt.toString(),
  };
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

// ── Health ───────────────────────────────────────────────────────────────────

app.get("/health", async (c) => {
  const slot = await connection.getSlot().catch(() => null);
  return c.json({
    status: "ok",
    cluster: CLUSTER,
    rpc: RPC_URL,
    programId: PROGRAM_ID.toString(),
    serverPubkey: serverKeypair.publicKey.toString(),
    currentSlot: slot,
    x402Enabled: X402_ENABLED,
    timestamp: new Date().toISOString(),
  });
});

// ── Protocol Info ─────────────────────────────────────────────────────────────

app.get("/info", (c) =>
  c.json({
    name: "StablePay Protocol",
    version: "1.0.0",
    description:
      "Institutional multi-sig USDC payment rails on Solana with x402 micropayment API",
    cluster: CLUSTER,
    programId: PROGRAM_ID.toString(),
    pricing: {
      "POST /vault": "0.05 USDC",
      "POST /vault/:id/propose": "0.01 USDC",
      "POST /vault/:id/approve/:n": "0.005 USDC",
      "POST /vault/:id/execute/:n": "0.01 USDC",
      "POST /vault/:id/cancel/:n": "0.005 USDC",
      "GET /vault/:id": "free",
      "GET /vault/:id/proposals": "free",
    },
    payment: {
      network: "base",
      asset: "USDC",
      receiver: X402_RECEIVER,
      standard: "x402",
      headerFormat: "X-Payment: <txHash>:<amountUsdc>",
    },
  })
);

// ── Initialize Vault ─────────────────────────────────────────────────────────

app.post("/vault", requirePayment(0.05), async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { threshold, approvers, transferLimit, usdcMint: mintStr } = body;

  if (typeof threshold !== "number" || threshold < 1) {
    return c.json({ error: "threshold must be a number >= 1" }, 400);
  }
  if (!Array.isArray(approvers) || approvers.length === 0) {
    return c.json({ error: "approvers must be a non-empty array of pubkeys" }, 400);
  }
  if (threshold > approvers.length) {
    return c.json({ error: "threshold cannot exceed approvers count" }, 400);
  }

  const approverKeys: PublicKey[] = [];
  for (const a of approvers) {
    const key = parsePubkey(String(a));
    if (!key) return c.json({ error: `Invalid approver pubkey: ${a}` }, 400);
    approverKeys.push(key);
  }

  const usdcMintPubkey = mintStr ? parsePubkey(String(mintStr)) : new PublicKey(DEVNET_USDC);
  if (!usdcMintPubkey) return c.json({ error: "Invalid usdcMint" }, 400);

  const limit = new BN(transferLimit ?? 0);

  try {
    const tx = await sdk.initializeVault({
      owner: serverKeypair,
      usdcMint: usdcMintPubkey,
      approvers: approverKeys,
      threshold,
      transferLimit: limit,
    });

    const [vaultPda] = findVaultPda(
      serverKeypair.publicKey,
      usdcMintPubkey,
      PROGRAM_ID
    );

    return c.json({
      success: true,
      vaultPda: vaultPda.toString(),
      owner: serverKeypair.publicKey.toString(),
      threshold,
      approvers: approverKeys.map((k) => k.toString()),
      transferLimit: limit.toString(),
      usdcMint: usdcMintPubkey.toString(),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Get Vault ─────────────────────────────────────────────────────────────────

app.get("/vault/:vaultPda", async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  try {
    const vault = await sdk.fetchVault(vaultKey).catch(() => null);
    if (!vault) return c.json({ error: "Vault not found" }, 404);

    return c.json({
      vaultPda: vaultKey.toString(),
      owner: vault.owner.toString(),
      usdcMint: vault.usdcMint.toString(),
      tokenAccount: vault.tokenAccount.toString(),
      threshold: vault.threshold,
      approvers: vault.approvers.map((k: PublicKey) => k.toString()),
      proposalCount: vault.proposalCount.toString(),
      transferLimit: vault.transferLimit.toString(),
      paused: vault.paused,
      allowlistEnabled: vault.allowlistEnabled,
      allowlist: vault.allowlist.map((k: PublicKey) => k.toString()),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Propose Transfer ──────────────────────────────────────────────────────────

app.post("/vault/:vaultPda/propose", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.amount || !body.destination) {
    return c.json({ error: "Required: amount (USDC lamports), destination (pubkey)" }, 400);
  }
  const destKey = parsePubkey(String(body.destination));
  if (!destKey) return c.json({ error: "Invalid destination pubkey" }, 400);

  try {
    // Read current proposal count before submitting (for response)
    const vaultBefore = await sdk.fetchVault(vaultKey);
    const proposalIndex = vaultBefore.proposalCount.toNumber();

    const tx = await sdk.proposeTransfer({
      vault: vaultKey,
      proposer: serverKeypair,
      amount: new BN(String(body.amount)),
      destination: destKey,
      memo: String(body.memo ?? ""),
    });

    const [proposalPda] = findProposalPda(vaultKey, proposalIndex, PROGRAM_ID);

    return c.json({
      success: true,
      proposalPda: proposalPda.toString(),
      proposalIndex,
      vaultPda: vaultKey.toString(),
      amount: String(body.amount),
      destination: destKey.toString(),
      memo: body.memo ?? "",
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Approve Proposal ──────────────────────────────────────────────────────────

app.post("/vault/:vaultPda/approve/:index", requirePayment(0.005), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  const index = parseIndex(c.req.param("index"));
  if (index === null) return c.json({ error: "Invalid proposal index" }, 400);

  try {
    const tx = await sdk.approveTransfer({
      vault: vaultKey,
      proposalIndex: index,
      approver: serverKeypair,
    });

    const [proposalPda] = findProposalPda(vaultKey, index, PROGRAM_ID);
    return c.json({
      success: true,
      proposalPda: proposalPda.toString(),
      proposalIndex: index,
      approvedBy: serverKeypair.publicKey.toString(),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Execute Transfer ──────────────────────────────────────────────────────────

app.post("/vault/:vaultPda/execute/:index", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  const index = parseIndex(c.req.param("index"));
  if (index === null) return c.json({ error: "Invalid proposal index" }, 400);

  try {
    const proposal = await sdk.fetchProposal(vaultKey, index);
    const vault = await sdk.fetchVault(vaultKey);

    const tx = await sdk.executeTransfer({
      vault: vaultKey,
      proposalIndex: index,
      executor: serverKeypair,
      destinationTokenAccount: proposal.destination,
    });

    return c.json({
      success: true,
      proposalIndex: index,
      destination: proposal.destination.toString(),
      amount: proposal.amount.toString(),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Cancel Proposal ───────────────────────────────────────────────────────────

app.post("/vault/:vaultPda/cancel/:index", requirePayment(0.005), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  const index = parseIndex(c.req.param("index"));
  if (index === null) return c.json({ error: "Invalid proposal index" }, 400);

  try {
    const tx = await sdk.cancelProposal({
      vault: vaultKey,
      proposalIndex: index,
      canceller: serverKeypair,
    });

    const [proposalPda] = findProposalPda(vaultKey, index, PROGRAM_ID);
    return c.json({
      success: true,
      proposalPda: proposalPda.toString(),
      proposalIndex: index,
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Get All Proposals ─────────────────────────────────────────────────────────

app.get("/vault/:vaultPda/proposals", async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  try {
    const vault = await sdk.fetchVault(vaultKey).catch(() => null);
    if (!vault) return c.json({ error: "Vault not found" }, 404);

    const proposals = await sdk.fetchAllProposals(vaultKey);
    return c.json({
      vaultPda: vaultKey.toString(),
      totalProposals: vault.proposalCount.toString(),
      proposals: proposals.map((p: TransferProposalAccount, i: number) => {
        const [pda] = findProposalPda(vaultKey, i, PROGRAM_ID);
        return serializeProposal(p, pda);
      }),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Get Proposal ──────────────────────────────────────────────────────────────

app.get("/vault/:vaultPda/proposals/:index", async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  const index = parseIndex(c.req.param("index"));
  if (index === null) return c.json({ error: "Invalid proposal index" }, 400);

  try {
    const proposal = await sdk.fetchProposal(vaultKey, index);
    const [proposalPda] = findProposalPda(vaultKey, index, PROGRAM_ID);
    return c.json(serializeProposal(proposal, proposalPda));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) return c.json({ error: msg }, 404);
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Compliance: Pause ─────────────────────────────────────────────────────────

app.patch("/vault/:vaultPda/pause", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.paused !== "boolean") {
    return c.json({ error: "Required: paused (boolean)" }, 400);
  }

  try {
    const tx = await sdk.setPaused({
      vault: vaultKey,
      owner: serverKeypair,
      paused: body.paused,
    });
    return c.json({
      success: true,
      vaultPda: vaultKey.toString(),
      paused: body.paused,
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Compliance: Transfer Limit ────────────────────────────────────────────────

app.patch("/vault/:vaultPda/limit", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (body.limit === undefined || body.limit === null) {
    return c.json({ error: "Required: limit (USDC in lamports, 0 = unlimited)" }, 400);
  }

  try {
    const tx = await sdk.setTransferLimit({
      vault: vaultKey,
      owner: serverKeypair,
      limit: new BN(String(body.limit)),
    });
    return c.json({
      success: true,
      vaultPda: vaultKey.toString(),
      newLimit: String(body.limit),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── Compliance: Allowlist ─────────────────────────────────────────────────────

app.post("/vault/:vaultPda/allowlist", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const addrKey = parsePubkey(String(body.address ?? ""));
  if (!addrKey) return c.json({ error: "Required: address (pubkey)" }, 400);

  try {
    const tx = await sdk.addToAllowlist({
      vault: vaultKey,
      owner: serverKeypair,
      address: addrKey,
    });
    return c.json({
      success: true,
      vaultPda: vaultKey.toString(),
      added: addrKey.toString(),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

app.delete("/vault/:vaultPda/allowlist/:addr", requirePayment(0.01), async (c) => {
  const vaultKey = parsePubkey(c.req.param("vaultPda"));
  if (!vaultKey) return c.json({ error: "Invalid vault PDA" }, 400);

  const addrKey = parsePubkey(c.req.param("addr"));
  if (!addrKey) return c.json({ error: "Invalid address" }, 400);

  try {
    const tx = await sdk.removeFromAllowlist({
      vault: vaultKey,
      owner: serverKeypair,
      address: addrKey,
    });
    return c.json({
      success: true,
      vaultPda: vaultKey.toString(),
      removed: addrKey.toString(),
      txSignature: tx,
      explorer: explorerLink(tx),
    });
  } catch (err) {
    return c.json({ error: anchorErr(err) }, 500);
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found", hint: "GET /info" }, 404));

// ─── Start ────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\nStablePay Protocol API`);
  console.log(`  Port:     ${info.port}`);
  console.log(`  Cluster:  ${CLUSTER}`);
  console.log(`  Program:  ${PROGRAM_ID.toString()}`);
  console.log(`  Payer:    ${serverKeypair.publicKey.toString()}`);
  console.log(`  x402:     ${X402_ENABLED ? "ENABLED" : "DISABLED"}`);
  console.log(`  Health:   http://localhost:${info.port}/health\n`);
});

export { app };
