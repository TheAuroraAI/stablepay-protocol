/**
 * StablePay Protocol — Full Multi-Sig Demo Flow
 *
 * Creates a fresh 2-of-2 multi-sig vault on devnet and runs the
 * complete institutional payment workflow:
 * 1. Initialize vault with 2 approvers
 * 2. Fund vault with test USDC
 * 3. Approver 1 proposes a transfer (auto-approves = 1 of 2)
 * 4. Approver 2 approves (threshold reached = 2 of 2)
 * 5. Execute the transfer
 *
 * Run: yarn ts-node --transpile-only scripts/demo_flow.ts
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  createMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  StablePaySDK,
  findVaultPda,
  findProposalPda,
} from "../sdk/index";
import type { StablepayProtocol } from "../types/stablepay_protocol";
import fs from "fs";
import path from "path";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF");

// Load owner keypair
const keyPath = path.join(process.env.HOME ?? "/root", ".config", "solana", "id.json");
const owner = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf-8")) as number[])
);

// Generate fresh approver keypairs for this demo
const approver1 = owner; // Owner is approver 1 (simplest)
const approver2Seed = Buffer.from("stablepay-demo-approver2-2026031", "utf-8");
const approver2 = Keypair.fromSeed(approver2Seed.slice(0, 32));

async function airdropIfNeeded(_connection: Connection, _pubkey: PublicKey, _minLamports: number) {
  // Approver2 pre-funded via solana transfer
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(owner),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const IDL_PATH = path.join(__dirname, "../idl/stablepay_protocol.json");
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8")) as anchor.Idl;
  const program = new Program<StablepayProtocol>(idl as any, provider);

  console.log("=== StablePay Protocol — Multi-Sig Demo Flow ===");
  console.log(`Owner/Approver1: ${owner.publicKey.toString()}`);
  console.log(`Approver2:       ${approver2.publicKey.toString()}`);

  // Fund approver2 if needed
  await airdropIfNeeded(connection, approver2.publicKey, 0.1 * LAMPORTS_PER_SOL);

  // Step 1: Create demo USDC mint
  console.log("\n[1] Creating demo USDC mint...");
  const usdcMint = await createMint(
    connection,
    owner,             // payer
    owner.publicKey,   // mint authority
    null,              // freeze authority
    6                  // decimals
  );
  console.log(`  USDC Mint: ${usdcMint.toString()}`);

  // Step 2: Initialize vault
  console.log("\n[2] Initializing 2-of-2 multi-sig vault...");
  const [vaultPda] = findVaultPda(owner.publicKey, usdcMint, PROGRAM_ID);

  // Generate a new keypair for the vault token account (Anchor init requires this)
  const vaultTokenAccountKp = Keypair.generate();

  const initTx = await (program.methods as any)
    .initializeVault(
      2,                                    // threshold: 2-of-2
      [owner.publicKey, approver2.publicKey], // approvers
      new BN(1_000_000_000)                 // transfer limit: 1000 USDC
    )
    .accounts({
      vault: vaultPda,
      vaultTokenAccount: vaultTokenAccountKp.publicKey,
      usdcMint,
      owner: owner.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultTokenAccountKp])
    .rpc();

  console.log(`  ✅ Vault initialized. TX: ${initTx}`);
  console.log(`  Vault PDA: ${vaultPda.toString()}`);

  // Step 3: Fund vault with 10 USDC
  console.log("\n[3] Funding vault with 10 USDC...");
  const fundTx = await mintTo(
    connection,
    owner,
    usdcMint,
    vaultTokenAccountKp.publicKey,
    owner,
    10_000_000  // 10 USDC
  );
  console.log(`  ✅ Funded. TX: ${fundTx}`);

  // Step 4: Create recipient token account
  console.log("\n[4] Setting up recipient...");
  const recipient = Keypair.generate();
  const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    usdcMint,
    recipient.publicKey
  );
  console.log(`  Recipient: ${recipient.publicKey.toString()}`);

  // Step 5: Propose transfer (owner/approver1 proposes + auto-approves)
  console.log("\n[5] Proposing 1 USDC transfer...");
  const [proposalPda] = findProposalPda(vaultPda, 0, PROGRAM_ID);

  const proposeTx = await (program.methods as any)
    .proposeTransfer(
      new BN(1_000_000),         // 1 USDC
      recipient.publicKey,        // destination
      "StableHacks 2026 demo"    // memo
    )
    .accounts({
      vault: vaultPda,
      proposal: proposalPda,
      proposer: owner.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  ✅ Proposed. TX: ${proposeTx}`);
  console.log("  Status: 1 of 2 approvals (proposer auto-approved)");

  // Step 6: Approver2 approves
  console.log("\n[6] Approver2 signing approval...");
  const approveTx = await (program.methods as any)
    .approveTransfer()
    .accounts({
      vault: vaultPda,
      proposal: proposalPda,
      approver: approver2.publicKey,
    })
    .signers([approver2])
    .rpc();

  console.log(`  ✅ Approved. TX: ${approveTx}`);
  console.log("  Status: 2 of 2 approvals — THRESHOLD REACHED");

  // Step 7: Execute transfer
  console.log("\n[7] Executing transfer...");
  const executeTx = await (program.methods as any)
    .executeTransfer()
    .accounts({
      vault: vaultPda,
      proposal: proposalPda,
      vaultTokenAccount: vaultTokenAccountKp.publicKey,
      destinationTokenAccount: recipientTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log(`  ✅ Executed! TX: ${executeTx}`);

  console.log("\n=== Full Multi-Sig Flow Complete ===");
  console.log("Demonstrated:");
  console.log("  initialize_vault → propose_transfer → approve_transfer → execute_transfer");
  console.log("");
  console.log("Solana Explorer (devnet):");
  console.log(`  Init:    https://explorer.solana.com/tx/${initTx}?cluster=devnet`);
  console.log(`  Fund:    https://explorer.solana.com/tx/${fundTx}?cluster=devnet`);
  console.log(`  Propose: https://explorer.solana.com/tx/${proposeTx}?cluster=devnet`);
  console.log(`  Approve: https://explorer.solana.com/tx/${approveTx}?cluster=devnet`);
  console.log(`  Execute: https://explorer.solana.com/tx/${executeTx}?cluster=devnet`);

  const results = {
    timestamp: new Date().toISOString(),
    network: "devnet",
    programId: PROGRAM_ID.toString(),
    vaultPda: vaultPda.toString(),
    usdcMint: usdcMint.toString(),
    proposalPda: proposalPda.toString(),
    transactions: {
      initializeVault: initTx,
      fundVault: fundTx,
      proposeTransfer: proposeTx,
      approveTransfer: approveTx,
      executeTransfer: executeTx,
    },
    vault: {
      owner: owner.publicKey.toString(),
      approvers: [owner.publicKey.toString(), approver2.publicKey.toString()],
      threshold: 2,
      transferAmountUsdc: 1.0,
    },
  };

  fs.writeFileSync(
    path.join(__dirname, "demo_flow_result.json"),
    JSON.stringify(results, null, 2)
  );
  console.log("\nResults saved to scripts/demo_flow_result.json");
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
