/**
 * StablePay Protocol SDK
 *
 * A TypeScript SDK for interacting with the StablePay multi-sig USDC vault protocol.
 * Provides typed methods for all 9 program instructions plus helper utilities.
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN, AnchorProvider } from "@anchor-lang/core";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { StablepayProtocol } from "../types/stablepay_protocol";

// ─── Constants ────────────────────────────────────────────────────────────────
export const VAULT_SEED = Buffer.from("stablepay-vault");
export const PROPOSAL_SEED = Buffer.from("stablepay-proposal");

export const MAX_APPROVERS = 10;
export const MAX_ALLOWLIST = 20;
export const MAX_MEMO_LEN = 64;

// ─── PDA Helpers ──────────────────────────────────────────────────────────────

/** Derive the vault PDA for a given owner and USDC mint */
export function findVaultPda(
  owner: PublicKey,
  usdcMint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), usdcMint.toBuffer()],
    programId
  );
}

/** Derive the proposal PDA for a vault at a given index */
export function findProposalPda(
  vault: PublicKey,
  proposalIndex: BN | number,
  programId: PublicKey
): [PublicKey, number] {
  const indexBuffer = Buffer.alloc(8);
  const index = typeof proposalIndex === "number" ? proposalIndex : proposalIndex.toNumber();
  indexBuffer.writeBigUInt64LE(BigInt(index));
  return PublicKey.findProgramAddressSync(
    [PROPOSAL_SEED, vault.toBuffer(), indexBuffer],
    programId
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaultAccount {
  owner: PublicKey;
  usdcMint: PublicKey;
  tokenAccount: PublicKey;
  approvers: PublicKey[];
  threshold: number;
  proposalCount: BN;
  transferLimit: BN;
  paused: boolean;
  allowlistEnabled: boolean;
  allowlist: PublicKey[];
  bump: number;
}

export interface TransferProposalAccount {
  vault: PublicKey;
  index: BN;
  destination: PublicKey;
  amount: BN;
  memo: string;
  proposer: PublicKey;
  approvals: PublicKey[];
  executed: boolean;
  cancelled: boolean;
  createdAt: BN;
  bump: number;
}

export interface InitializeVaultParams {
  owner: Keypair;
  usdcMint: PublicKey;
  approvers: PublicKey[];
  threshold: number;
  transferLimit?: BN;
}

export interface ProposeTransferParams {
  vault: PublicKey;
  proposer: Keypair;
  amount: BN;
  destination: PublicKey;
  memo?: string;
}

export interface ApproveTransferParams {
  vault: PublicKey;
  proposalIndex: number;
  approver: Keypair;
}

export interface ExecuteTransferParams {
  vault: PublicKey;
  proposalIndex: number;
  executor: Keypair;
  destinationTokenAccount: PublicKey;
}

export interface CancelProposalParams {
  vault: PublicKey;
  proposalIndex: number;
  canceller: Keypair;
}

export interface ComplianceParams {
  vault: PublicKey;
  owner: Keypair;
}

// ─── SDK Class ────────────────────────────────────────────────────────────────

export class StablePaySDK {
  public program: Program<StablepayProtocol>;
  public provider: AnchorProvider;

  constructor(program: Program<StablepayProtocol>) {
    this.program = program;
    this.provider = program.provider as AnchorProvider;
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  // ─── Instruction Methods ────────────────────────────────────────────────────

  /**
   * Initialize a new multi-sig USDC vault.
   *
   * @param params.owner - Vault owner and initial payer
   * @param params.usdcMint - The USDC mint public key
   * @param params.approvers - List of approver public keys (max 10)
   * @param params.threshold - Minimum approvals required to execute transfers
   * @param params.transferLimit - Max USDC per transfer (0 = unlimited)
   * @returns Transaction signature
   */
  async initializeVault(params: InitializeVaultParams): Promise<string> {
    const { owner, usdcMint, approvers, threshold, transferLimit = new BN(0) } = params;

    if (approvers.length === 0 || approvers.length > MAX_APPROVERS) {
      throw new Error(`Approvers must be 1-${MAX_APPROVERS}`);
    }
    if (threshold < 1 || threshold > approvers.length) {
      throw new Error(`Threshold must be between 1 and ${approvers.length}`);
    }

    const [vaultPda] = findVaultPda(owner.publicKey, usdcMint, this.programId);
    const vaultTokenAccount = Keypair.generate();

    const tx = await this.program.methods
      .initializeVault(threshold, approvers, transferLimit)
      .accountsPartial({
        vault: vaultPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        usdcMint,
        owner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([owner, vaultTokenAccount])
      .rpc();

    return tx;
  }

  /**
   * Create a transfer proposal. Proposer auto-approves.
   *
   * @param params.vault - Vault public key
   * @param params.proposer - Signer (must be a vault approver)
   * @param params.amount - Amount in USDC lamports (6 decimals: 1 USDC = 1_000_000)
   * @param params.destination - Recipient wallet public key
   * @param params.memo - Optional memo string (max 64 bytes)
   * @returns Transaction signature
   */
  async proposeTransfer(params: ProposeTransferParams): Promise<string> {
    const { vault, proposer, amount, destination, memo = "" } = params;

    if (memo.length > MAX_MEMO_LEN) {
      throw new Error(`Memo exceeds ${MAX_MEMO_LEN} bytes`);
    }

    const vaultAccount = await this.fetchVault(vault);
    const proposalIndex = vaultAccount.proposalCount.toNumber();
    const [proposalPda] = findProposalPda(vault, proposalIndex, this.programId);

    const tx = await this.program.methods
      .proposeTransfer(amount, destination, memo)
      .accountsPartial({
        vault,
        proposal: proposalPda,
        proposer: proposer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();

    return tx;
  }

  /**
   * Add an approval to a pending proposal.
   *
   * @param params.vault - Vault public key
   * @param params.proposalIndex - Index of the proposal to approve
   * @param params.approver - Signer (must be a vault approver, not yet approved)
   * @returns Transaction signature
   */
  async approveTransfer(params: ApproveTransferParams): Promise<string> {
    const { vault, proposalIndex, approver } = params;
    const [proposalPda] = findProposalPda(vault, proposalIndex, this.programId);

    const tx = await this.program.methods
      .approveTransfer()
      .accountsPartial({
        vault,
        proposal: proposalPda,
        approver: approver.publicKey,
      })
      .signers([approver])
      .rpc();

    return tx;
  }

  /**
   * Execute a proposal that has reached approval threshold.
   * Transfers USDC from vault to destination.
   *
   * @param params.vault - Vault public key
   * @param params.proposalIndex - Index of the proposal to execute
   * @param params.executor - Signer (must be a vault approver)
   * @param params.destinationTokenAccount - Recipient's USDC token account
   * @returns Transaction signature
   */
  async executeTransfer(params: ExecuteTransferParams): Promise<string> {
    const { vault, proposalIndex, executor, destinationTokenAccount } = params;
    const [proposalPda] = findProposalPda(vault, proposalIndex, this.programId);
    const vaultAccount = await this.fetchVault(vault);

    const tx = await this.program.methods
      .executeTransfer()
      .accountsPartial({
        vault,
        proposal: proposalPda,
        vaultTokenAccount: vaultAccount.tokenAccount,
        destinationTokenAccount,
        executor: executor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([executor])
      .rpc();

    return tx;
  }

  /**
   * Cancel a pending proposal. Only proposer or vault owner can cancel.
   *
   * @param params.vault - Vault public key
   * @param params.proposalIndex - Index of the proposal to cancel
   * @param params.canceller - Signer (must be proposer or vault owner)
   * @returns Transaction signature
   */
  async cancelProposal(params: CancelProposalParams): Promise<string> {
    const { vault, proposalIndex, canceller } = params;
    const [proposalPda] = findProposalPda(vault, proposalIndex, this.programId);

    const tx = await this.program.methods
      .cancelProposal()
      .accountsPartial({
        vault,
        proposal: proposalPda,
        canceller: canceller.publicKey,
      })
      .signers([canceller])
      .rpc();

    return tx;
  }

  /**
   * Pause or unpause the vault. Only owner can call.
   *
   * @param params.vault - Vault public key
   * @param params.owner - Vault owner signer
   * @param paused - true to pause, false to unpause
   * @returns Transaction signature
   */
  async setPaused(params: ComplianceParams & { paused: boolean }): Promise<string> {
    const { vault, owner, paused } = params;

    const tx = await this.program.methods
      .setPaused(paused)
      .accountsPartial({
        vault,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    return tx;
  }

  /**
   * Update the per-transfer USDC limit. Only owner can call.
   * Set to 0 to disable the limit.
   *
   * @param params.vault - Vault public key
   * @param params.owner - Vault owner signer
   * @param limit - New transfer limit in USDC lamports
   * @returns Transaction signature
   */
  async setTransferLimit(params: ComplianceParams & { limit: BN }): Promise<string> {
    const { vault, owner, limit } = params;

    const tx = await this.program.methods
      .setTransferLimit(limit)
      .accountsPartial({
        vault,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    return tx;
  }

  /**
   * Add an address to the vault allowlist.
   * Once allowlist is non-empty, only listed addresses can receive transfers.
   *
   * @param params.vault - Vault public key
   * @param params.owner - Vault owner signer
   * @param address - Address to add
   * @returns Transaction signature
   */
  async addToAllowlist(params: ComplianceParams & { address: PublicKey }): Promise<string> {
    const { vault, owner, address } = params;

    const tx = await this.program.methods
      .addToAllowlist(address)
      .accountsPartial({
        vault,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    return tx;
  }

  /**
   * Remove an address from the vault allowlist.
   *
   * @param params.vault - Vault public key
   * @param params.owner - Vault owner signer
   * @param address - Address to remove
   * @returns Transaction signature
   */
  async removeFromAllowlist(params: ComplianceParams & { address: PublicKey }): Promise<string> {
    const { vault, owner, address } = params;

    const tx = await this.program.methods
      .removeFromAllowlist(address)
      .accountsPartial({
        vault,
        owner: owner.publicKey,
      })
      .signers([owner])
      .rpc();

    return tx;
  }

  // ─── Fetch Methods ──────────────────────────────────────────────────────────

  /**
   * Fetch and deserialize a vault account.
   * @throws Error if vault not found
   */
  async fetchVault(vaultPda: PublicKey): Promise<VaultAccount> {
    const account = await this.program.account.vault.fetchNullable(vaultPda);
    if (!account) {
      throw new Error(`Vault not found: ${vaultPda.toBase58()}`);
    }
    return account as unknown as VaultAccount;
  }

  /**
   * Fetch and deserialize a transfer proposal.
   * @throws Error if proposal not found
   */
  async fetchProposal(
    vault: PublicKey,
    proposalIndex: number
  ): Promise<TransferProposalAccount> {
    const [proposalPda] = findProposalPda(vault, proposalIndex, this.programId);
    const account = await this.program.account.transferProposal.fetchNullable(proposalPda);
    if (!account) {
      throw new Error(`Proposal #${proposalIndex} not found`);
    }
    return account as unknown as TransferProposalAccount;
  }

  /**
   * Fetch all proposals for a vault.
   * Returns them in creation order (index ascending).
   */
  async fetchAllProposals(vault: PublicKey): Promise<TransferProposalAccount[]> {
    const vaultAccount = await this.fetchVault(vault);
    const count = vaultAccount.proposalCount.toNumber();
    const proposals: TransferProposalAccount[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const proposal = await this.fetchProposal(vault, i);
        proposals.push(proposal);
      } catch {
        // Skip missing proposals (shouldn't happen, but be defensive)
      }
    }

    return proposals;
  }

  /**
   * Check if a vault exists on-chain.
   */
  async vaultExists(owner: PublicKey, usdcMint: PublicKey): Promise<boolean> {
    const [vaultPda] = findVaultPda(owner, usdcMint, this.programId);
    const account = await this.program.account.vault.fetchNullable(vaultPda);
    return account !== null;
  }

  /**
   * Get the PDA for a vault given owner and mint.
   */
  getVaultPda(owner: PublicKey, usdcMint: PublicKey): PublicKey {
    const [pda] = findVaultPda(owner, usdcMint, this.programId);
    return pda;
  }

  /**
   * Get the PDA for a proposal given vault and index.
   */
  getProposalPda(vault: PublicKey, proposalIndex: number): PublicKey {
    const [pda] = findProposalPda(vault, proposalIndex, this.programId);
    return pda;
  }
}
