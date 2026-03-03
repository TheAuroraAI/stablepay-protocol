/**
 * Create a demo vault on devnet for the StablePay Protocol dashboard.
 *
 * This script:
 * 1. Uses devnet USDC (4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
 * 2. Creates a 2-of-3 multi-sig vault owned by the server keypair
 * 3. Outputs the vault PDA and all account details
 * 4. Saves results to scripts/demo_vault.json
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { StablePaySDK, findVaultPda } from "../sdk/index";
import type { StablepayProtocol } from "../types/stablepay_protocol";
import fs from "fs";
import path from "path";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF");

// Load keypair
const keyPath = path.join(process.env.HOME ?? "/root", ".config", "solana", "id.json");
const bytes = JSON.parse(fs.readFileSync(keyPath, "utf-8")) as number[];
const owner = Keypair.fromSecretKey(Uint8Array.from(bytes));

// Generate 3 approver keypairs (deterministic for demo repeatability)
const approver1 = Keypair.fromSeed(Buffer.alloc(32, 1));
const approver2 = Keypair.fromSeed(Buffer.alloc(32, 2));
const approver3 = Keypair.fromSeed(Buffer.alloc(32, 3));

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Load IDL
  const IDL_PATH = path.join(__dirname, "../idl/stablepay_protocol.json");
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8")) as anchor.Idl;
  const program = new Program<StablepayProtocol>(idl as any, provider);
  const sdk = new StablePaySDK(program as any);

  console.log("Owner:", owner.publicKey.toString());
  console.log("Balance:", (await connection.getBalance(owner.publicKey)) / 1e9, "SOL");

  // Step 1: Create a demo USDC-like mint (we control supply on devnet)
  console.log("\n[1] Creating demo stablecoin mint...");
  const usdcMint = await createMint(
    connection,
    owner,          // payer
    owner.publicKey, // mint authority
    owner.publicKey, // freeze authority
    6,              // 6 decimals (matches USDC)
  );
  console.log("Demo USDC mint:", usdcMint.toString());

  // Step 2: Create owner's token account and mint 10,000 USDC
  console.log("\n[2] Creating owner token account and minting 10,000 demo USDC...");
  const ownerTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    usdcMint,
    owner.publicKey
  );
  await mintTo(
    connection,
    owner,
    usdcMint,
    ownerTokenAccount.address,
    owner,
    10_000 * 1_000_000 // 10,000 USDC (6 decimals)
  );
  console.log("Owner token account:", ownerTokenAccount.address.toString());

  // Step 3: Initialize vault
  console.log("\n[3] Initializing 2-of-3 multi-sig vault...");
  const vaultParams = {
    owner,
    usdcMint,
    approvers: [approver1.publicKey, approver2.publicKey, approver3.publicKey],
    threshold: 2,
    transferLimit: new BN(1000 * 1_000_000), // 1,000 USDC limit per transfer
  };

  const [vaultPda] = findVaultPda(owner.publicKey, usdcMint, PROGRAM_ID);
  console.log("Vault PDA:", vaultPda.toString());

  let txSig: string;
  try {
    txSig = await sdk.initializeVault(vaultParams);
    console.log("Vault initialized! TX:", txSig);
  } catch (err: any) {
    if (err?.message?.includes("already in use") || err?.message?.includes("custom program error: 0x0")) {
      console.log("Vault already exists, fetching...");
      txSig = "already_exists";
    } else {
      throw err;
    }
  }

  // Step 4: Deposit 5,000 USDC into vault
  console.log("\n[4] Depositing 5,000 demo USDC into vault...");
  let depositTx: string;
  try {
    depositTx = await sdk.deposit({
      owner,
      vaultPda,
      ownerTokenAccount: ownerTokenAccount.address,
      amount: new BN(5000 * 1_000_000),
    });
    console.log("Deposit TX:", depositTx);
  } catch (err: any) {
    console.log("Deposit error (may already be deposited):", err?.message);
    depositTx = "error";
  }

  // Step 5: Fetch vault state
  console.log("\n[5] Fetching vault state...");
  const vault = await sdk.fetchVault(vaultPda);

  // Save results
  const results = {
    network: "devnet",
    programId: PROGRAM_ID.toString(),
    owner: owner.publicKey.toString(),
    usdcMint: usdcMint.toString(),
    vaultPda: vaultPda.toString(),
    approvers: [approver1.publicKey.toString(), approver2.publicKey.toString(), approver3.publicKey.toString()],
    threshold: 2,
    transferLimit: "1000 USDC",
    transactions: {
      vault_init: txSig,
      deposit: depositTx,
    },
    vault_state: vault ? {
      owner: vault.owner.toString(),
      threshold: vault.threshold,
      proposalCount: vault.proposalCount.toString(),
      transferLimit: vault.transferLimit.toString(),
      paused: vault.paused,
      allowlistEnabled: vault.allowlistEnabled,
    } : null,
    created_at: new Date().toISOString(),
    explorer_url: `https://explorer.solana.com/address/${vaultPda.toString()}?cluster=devnet`,
  };

  const outPath = path.join(__dirname, "demo_vault.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log("\n✅ Demo vault created. Results saved to:", outPath);
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
