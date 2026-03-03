/**
 * StablePay Protocol — Comprehensive Test Suite
 *
 * Tests all 9 instructions with happy paths and error cases.
 * Uses a local validator with a mock USDC mint.
 */

import * as anchor from "@anchor-lang/core";
import { Program, BN, AnchorProvider } from "@anchor-lang/core";
import {
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { StablepayProtocol } from "../target/types/stablepay_protocol";
import { StablePaySDK, findVaultPda, findProposalPda } from "../sdk/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function airdrop(
  provider: AnchorProvider,
  pubkey: PublicKey,
  sol = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

async function assertError(
  fn: () => Promise<unknown>,
  errorCode: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`Expected error ${errorCode} but succeeded`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.include(msg, errorCode, `Expected error to include "${errorCode}"`);
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("stablepay-protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.stablepayProtocol as Program<StablepayProtocol>;
  const sdk = new StablePaySDK(program);

  // Keypairs
  const owner = Keypair.generate();
  const approver1 = Keypair.generate();
  const approver2 = Keypair.generate();
  const approver3 = Keypair.generate();
  const recipient = Keypair.generate();
  const outsider = Keypair.generate();

  // Shared state
  let usdcMint: PublicKey;
  let vaultPda: PublicKey;
  let vaultTokenAccount: PublicKey;
  let recipientTokenAccount: PublicKey;

  // ─── Setup ────────────────────────────────────────────────────────────────

  before(async () => {
    // Fund all accounts
    await Promise.all([
      airdrop(provider, owner.publicKey),
      airdrop(provider, approver1.publicKey),
      airdrop(provider, approver2.publicKey),
      airdrop(provider, approver3.publicKey),
      airdrop(provider, recipient.publicKey),
      airdrop(provider, outsider.publicKey),
    ]);

    // Create mock USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      owner,           // payer
      owner.publicKey, // mint authority
      null,            // freeze authority
      6                // decimals (USDC standard)
    );

    // Create recipient token account
    recipientTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      owner,
      usdcMint,
      recipient.publicKey
    );
  });

  // ─── 1. initialize_vault ─────────────────────────────────────────────────

  describe("initialize_vault", () => {
    it("creates a 2-of-3 multi-sig vault successfully", async () => {
      const vaultTokenKp = Keypair.generate();

      const tx = await program.methods
        .initializeVault(
          2, // threshold
          [approver1.publicKey, approver2.publicKey, approver3.publicKey],
          new BN(1_000_000_000) // 1000 USDC limit
        )
        .accountsPartial({
          vault: sdk.getVaultPda(owner.publicKey, usdcMint),
          vaultTokenAccount: vaultTokenKp.publicKey,
          usdcMint,
          owner: owner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([owner, vaultTokenKp])
        .rpc();

      assert.ok(tx, "transaction should succeed");

      // Verify vault state
      [vaultPda] = findVaultPda(owner.publicKey, usdcMint, program.programId);
      const vault = await sdk.fetchVault(vaultPda);

      assert.equal(vault.owner.toBase58(), owner.publicKey.toBase58());
      assert.equal(vault.threshold, 2);
      assert.equal(vault.approvers.length, 3);
      assert.equal(vault.proposalCount.toNumber(), 0);
      assert.equal(vault.transferLimit.toString(), "1000000000");
      assert.equal(vault.paused, false);
      assert.equal(vault.allowlistEnabled, false);
      assert.equal(vault.allowlist.length, 0);

      vaultTokenAccount = vault.tokenAccount;
    });

    it("rejects threshold = 0", async () => {
      const newOwner = Keypair.generate();
      const newMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
      await airdrop(provider, newOwner.publicKey);
      const vaultTokenKp = Keypair.generate();

      await assertError(async () => {
        await program.methods
          .initializeVault(0, [newOwner.publicKey], new BN(0))
          .accountsPartial({
            vault: sdk.getVaultPda(newOwner.publicKey, newMint),
            vaultTokenAccount: vaultTokenKp.publicKey,
            usdcMint: newMint,
            owner: newOwner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([newOwner, vaultTokenKp])
          .rpc();
      }, "InvalidThreshold");
    });

    it("rejects threshold > number of approvers", async () => {
      const newOwner = Keypair.generate();
      const newMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
      await airdrop(provider, newOwner.publicKey);
      const vaultTokenKp = Keypair.generate();

      await assertError(async () => {
        await program.methods
          .initializeVault(
            3, // threshold > approvers.length (2)
            [approver1.publicKey, approver2.publicKey],
            new BN(0)
          )
          .accountsPartial({
            vault: sdk.getVaultPda(newOwner.publicKey, newMint),
            vaultTokenAccount: vaultTokenKp.publicKey,
            usdcMint: newMint,
            owner: newOwner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([newOwner, vaultTokenKp])
          .rpc();
      }, "InvalidThreshold");
    });
  });

  // ─── 2. propose_transfer ─────────────────────────────────────────────────

  describe("propose_transfer", () => {
    it("approver creates a transfer proposal (auto-approves)", async () => {
      const tx = await program.methods
        .proposeTransfer(
          new BN(100_000_000), // 100 USDC
          recipient.publicKey,
          "Payment for services"
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, 0),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      assert.ok(tx);

      // Verify proposal state
      const proposal = await sdk.fetchProposal(vaultPda, 0);

      assert.equal(proposal.vault.toBase58(), vaultPda.toBase58());
      assert.equal(proposal.index.toNumber(), 0);
      assert.equal(proposal.destination.toBase58(), recipient.publicKey.toBase58());
      assert.equal(proposal.amount.toString(), "100000000");
      assert.equal(proposal.memo, "Payment for services");
      assert.equal(proposal.proposer.toBase58(), approver1.publicKey.toBase58());
      assert.equal(proposal.approvals.length, 1, "proposer auto-approves");
      assert.include(
        proposal.approvals.map((k) => k.toBase58()),
        approver1.publicKey.toBase58()
      );
      assert.equal(proposal.executed, false);
      assert.equal(proposal.cancelled, false);

      // Vault proposal count incremented
      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.proposalCount.toNumber(), 1);
    });

    it("rejects proposal from non-approver", async () => {
      await assertError(async () => {
        await program.methods
          .proposeTransfer(
            new BN(50_000_000),
            recipient.publicKey,
            "Unauthorized"
          )
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, 1),
            proposer: outsider.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([outsider])
          .rpc();
      }, "NotAnApprover");
    });

    it("rejects memo exceeding 64 bytes", async () => {
      const longMemo = "x".repeat(65);
      await assertError(async () => {
        await program.methods
          .proposeTransfer(new BN(1_000_000), recipient.publicKey, longMemo)
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, 1),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "MemoTooLong");
    });

    it("rejects amount exceeding transfer limit", async () => {
      // Vault limit = 1_000_000_000 (1000 USDC), try 1001 USDC
      await assertError(async () => {
        await program.methods
          .proposeTransfer(
            new BN(1_001_000_000), // 1001 USDC
            recipient.publicKey,
            "Over limit"
          )
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, 1),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "ExceedsTransferLimit");
    });
  });

  // ─── 3. approve_transfer ─────────────────────────────────────────────────

  describe("approve_transfer", () => {
    it("second approver approves proposal #0", async () => {
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      const tx = await program.methods
        .approveTransfer()
        .accountsPartial({
          vault: vaultPda,
          proposal: proposalPda,
          approver: approver2.publicKey,
        })
        .signers([approver2])
        .rpc();

      assert.ok(tx);

      const proposal = await sdk.fetchProposal(vaultPda, 0);
      assert.equal(proposal.approvals.length, 2);
      assert.include(
        proposal.approvals.map((k) => k.toBase58()),
        approver2.publicKey.toBase58()
      );
    });

    it("rejects duplicate approval from same approver", async () => {
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      await assertError(async () => {
        await program.methods
          .approveTransfer()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            approver: approver1.publicKey, // already approved
          })
          .signers([approver1])
          .rpc();
      }, "AlreadyApproved");
    });

    it("rejects approval from non-approver", async () => {
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      await assertError(async () => {
        await program.methods
          .approveTransfer()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            approver: outsider.publicKey,
          })
          .signers([outsider])
          .rpc();
      }, "NotAnApprover");
    });
  });

  // ─── 4. execute_transfer ─────────────────────────────────────────────────

  describe("execute_transfer", () => {
    const MINT_AMOUNT = 500_000_000; // 500 USDC

    before(async () => {
      // Fund the vault with 500 USDC
      await mintTo(
        provider.connection,
        owner,
        usdcMint,
        vaultTokenAccount,
        owner,
        MINT_AMOUNT
      );
    });

    it("executes proposal #0 after threshold met (transfers USDC)", async () => {
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      const recipientBalanceBefore = await getAccount(
        provider.connection,
        recipientTokenAccount
      );

      const tx = await program.methods
        .executeTransfer()
        .accountsPartial({
          vault: vaultPda,
          proposal: proposalPda,
          vaultTokenAccount,
          destinationTokenAccount: recipientTokenAccount,
          executor: approver1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([approver1])
        .rpc();

      assert.ok(tx);

      // Verify proposal marked as executed
      const proposal = await sdk.fetchProposal(vaultPda, 0);
      assert.equal(proposal.executed, true);

      // Verify USDC transferred
      const recipientBalanceAfter = await getAccount(
        provider.connection,
        recipientTokenAccount
      );
      const expectedTransfer = BigInt(100_000_000); // 100 USDC
      assert.equal(
        recipientBalanceAfter.amount - recipientBalanceBefore.amount,
        expectedTransfer,
        "recipient should receive exactly 100 USDC"
      );
    });

    it("rejects executing an already-executed proposal", async () => {
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      await assertError(async () => {
        await program.methods
          .executeTransfer()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            vaultTokenAccount,
            destinationTokenAccount: recipientTokenAccount,
            executor: approver1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([approver1])
          .rpc();
      }, "ProposalAlreadyExecuted");
    });

    it("rejects execution with insufficient approvals", async () => {
      // Create new proposal (only auto-approved by proposer = 1 approval, threshold = 2)
      const vaultBefore = await sdk.fetchVault(vaultPda);
      const proposalIdx = vaultBefore.proposalCount.toNumber();

      await program.methods
        .proposeTransfer(
          new BN(50_000_000),
          recipient.publicKey,
          "Needs second approval"
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, proposalIdx),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      const [proposalPda] = findProposalPda(vaultPda, proposalIdx, program.programId);

      await assertError(async () => {
        await program.methods
          .executeTransfer()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            vaultTokenAccount,
            destinationTokenAccount: recipientTokenAccount,
            executor: approver1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([approver1])
          .rpc();
      }, "InsufficientApprovals");
    });
  });

  // ─── 5. cancel_proposal ──────────────────────────────────────────────────

  describe("cancel_proposal", () => {
    let cancelProposalIdx: number;

    before(async () => {
      // Create a proposal to cancel
      const vault = await sdk.fetchVault(vaultPda);
      cancelProposalIdx = vault.proposalCount.toNumber();

      await program.methods
        .proposeTransfer(
          new BN(10_000_000),
          recipient.publicKey,
          "To be cancelled"
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, cancelProposalIdx),
          proposer: approver2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver2])
        .rpc();
    });

    it("proposer can cancel their own proposal", async () => {
      const [proposalPda] = findProposalPda(vaultPda, cancelProposalIdx, program.programId);

      const tx = await program.methods
        .cancelProposal()
        .accountsPartial({
          vault: vaultPda,
          proposal: proposalPda,
          canceller: approver2.publicKey,
        })
        .signers([approver2])
        .rpc();

      assert.ok(tx);

      const proposal = await sdk.fetchProposal(vaultPda, cancelProposalIdx);
      assert.equal(proposal.cancelled, true);
    });

    it("rejects cancelling an already-cancelled proposal", async () => {
      const [proposalPda] = findProposalPda(vaultPda, cancelProposalIdx, program.programId);

      await assertError(async () => {
        await program.methods
          .cancelProposal()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            canceller: approver2.publicKey,
          })
          .signers([approver2])
          .rpc();
      }, "ProposalCancelled");
    });

    it("rejects cancellation by non-proposer non-owner", async () => {
      // Create new proposal
      const vault = await sdk.fetchVault(vaultPda);
      const newIdx = vault.proposalCount.toNumber();

      await program.methods
        .proposeTransfer(new BN(5_000_000), recipient.publicKey, "Not yours to cancel")
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, newIdx),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      const [proposalPda] = findProposalPda(vaultPda, newIdx, program.programId);

      await assertError(async () => {
        await program.methods
          .cancelProposal()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            canceller: approver3.publicKey, // not proposer, not owner
          })
          .signers([approver3])
          .rpc();
      }, "NotProposer");
    });

    it("vault owner can cancel any proposal", async () => {
      // Create another proposal from approver3
      const vault = await sdk.fetchVault(vaultPda);
      const newIdx = vault.proposalCount.toNumber();

      await program.methods
        .proposeTransfer(new BN(5_000_000), recipient.publicKey, "Owner can cancel")
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, newIdx),
          proposer: approver3.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver3])
        .rpc();

      const [proposalPda] = findProposalPda(vaultPda, newIdx, program.programId);

      // Owner cancels (not the proposer)
      const tx = await program.methods
        .cancelProposal()
        .accountsPartial({
          vault: vaultPda,
          proposal: proposalPda,
          canceller: owner.publicKey,
        })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const proposal = await sdk.fetchProposal(vaultPda, newIdx);
      assert.equal(proposal.cancelled, true);
    });
  });

  // ─── 6. set_paused ───────────────────────────────────────────────────────

  describe("set_paused", () => {
    it("owner can pause the vault", async () => {
      const tx = await program.methods
        .setPaused(true)
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.paused, true);
    });

    it("rejects proposals when vault is paused", async () => {
      const vault = await sdk.fetchVault(vaultPda);
      const newIdx = vault.proposalCount.toNumber();

      await assertError(async () => {
        await program.methods
          .proposeTransfer(new BN(1_000_000), recipient.publicKey, "paused vault")
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, newIdx),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "VaultPaused");
    });

    it("owner can unpause the vault", async () => {
      const tx = await program.methods
        .setPaused(false)
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.paused, false);
    });

    it("non-owner cannot pause the vault", async () => {
      await assertError(async () => {
        await program.methods
          .setPaused(true)
          .accountsPartial({ vault: vaultPda, owner: approver1.publicKey })
          .signers([approver1])
          .rpc();
      }, "NotOwner");
    });
  });

  // ─── 7. set_transfer_limit ───────────────────────────────────────────────

  describe("set_transfer_limit", () => {
    it("owner can update the transfer limit", async () => {
      const newLimit = new BN(500_000_000); // 500 USDC

      const tx = await program.methods
        .setTransferLimit(newLimit)
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.transferLimit.toString(), "500000000");
    });

    it("owner can remove limit by setting to 0", async () => {
      const tx = await program.methods
        .setTransferLimit(new BN(0))
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.transferLimit.toNumber(), 0);
    });

    it("rejects transfer limit change from non-owner", async () => {
      await assertError(async () => {
        await program.methods
          .setTransferLimit(new BN(1_000))
          .accountsPartial({ vault: vaultPda, owner: approver1.publicKey })
          .signers([approver1])
          .rpc();
      }, "NotOwner");
    });
  });

  // ─── 8. add_to_allowlist / remove_from_allowlist ─────────────────────────

  describe("allowlist", () => {
    const allowedRecipient = Keypair.generate();

    it("owner can add an address to the allowlist", async () => {
      const tx = await program.methods
        .addToAllowlist(allowedRecipient.publicKey)
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      assert.equal(vault.allowlistEnabled, true);
      assert.equal(vault.allowlist.length, 1);
      assert.include(
        vault.allowlist.map((k) => k.toBase58()),
        allowedRecipient.publicKey.toBase58()
      );
    });

    it("rejects proposals to non-allowlisted destinations", async () => {
      const vault = await sdk.fetchVault(vaultPda);
      const newIdx = vault.proposalCount.toNumber();

      await assertError(async () => {
        await program.methods
          .proposeTransfer(
            new BN(10_000_000),
            recipient.publicKey, // not in allowlist
            "blocked by allowlist"
          )
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, newIdx),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "DestinationNotAllowed");
    });

    it("allows proposals to allowlisted destinations", async () => {
      const vault = await sdk.fetchVault(vaultPda);
      const newIdx = vault.proposalCount.toNumber();

      const tx = await program.methods
        .proposeTransfer(
          new BN(10_000_000),
          allowedRecipient.publicKey, // in allowlist
          "allowlisted"
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, newIdx),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      assert.ok(tx);
    });

    it("owner can remove an address from the allowlist", async () => {
      const tx = await program.methods
        .removeFromAllowlist(allowedRecipient.publicKey)
        .accountsPartial({ vault: vaultPda, owner: owner.publicKey })
        .signers([owner])
        .rpc();

      assert.ok(tx);

      const vault = await sdk.fetchVault(vaultPda);
      // allowlistEnabled persists but the address is gone
      assert.notInclude(
        vault.allowlist.map((k) => k.toBase58()),
        allowedRecipient.publicKey.toBase58()
      );
    });

    it("rejects allowlist modification from non-owner", async () => {
      await assertError(async () => {
        await program.methods
          .addToAllowlist(outsider.publicKey)
          .accountsPartial({ vault: vaultPda, owner: approver1.publicKey })
          .signers([approver1])
          .rpc();
      }, "NotOwner");
    });
  });

  // ─── 9. SDK helper tests ──────────────────────────────────────────────────

  describe("SDK helpers", () => {
    it("fetchAllProposals returns all proposals in order", async () => {
      const proposals = await sdk.fetchAllProposals(vaultPda);
      const vault = await sdk.fetchVault(vaultPda);

      assert.equal(proposals.length, vault.proposalCount.toNumber());

      // Verify ascending index order
      for (let i = 0; i < proposals.length; i++) {
        assert.equal(proposals[i].index.toNumber(), i);
      }
    });

    it("vaultExists returns true for initialized vault", async () => {
      const exists = await sdk.vaultExists(owner.publicKey, usdcMint);
      assert.equal(exists, true);
    });

    it("vaultExists returns false for uninitialized vault", async () => {
      const randomOwner = Keypair.generate();
      const exists = await sdk.vaultExists(randomOwner.publicKey, usdcMint);
      assert.equal(exists, false);
    });

    it("fetchVault throws for non-existent vault", async () => {
      const randomPda = Keypair.generate().publicKey;
      await assertError(async () => {
        await sdk.fetchVault(randomPda);
      }, "not found");
    });
  });

  // ─── 10. 1-of-1 vault edge case ──────────────────────────────────────────

  describe("1-of-1 vault (auto-execute eligible)", () => {
    let soloVaultPda: PublicKey;
    let soloVaultTokenAccount: PublicKey;
    let soloRecipientTokenAccount: PublicKey;
    const soloOwner = Keypair.generate();
    let soloMint: PublicKey;

    before(async () => {
      await airdrop(provider, soloOwner.publicKey);

      soloMint = await createMint(
        provider.connection,
        soloOwner,
        soloOwner.publicKey,
        null,
        6
      );

      const soloRecipient = Keypair.generate();
      await airdrop(provider, soloRecipient.publicKey);

      soloRecipientTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        soloOwner,
        soloMint,
        soloRecipient.publicKey
      );

      [soloVaultPda] = findVaultPda(soloOwner.publicKey, soloMint, program.programId);
      const vaultTokenKp = Keypair.generate();

      await program.methods
        .initializeVault(
          1, // 1-of-1
          [soloOwner.publicKey],
          new BN(0) // no limit
        )
        .accountsPartial({
          vault: soloVaultPda,
          vaultTokenAccount: vaultTokenKp.publicKey,
          usdcMint: soloMint,
          owner: soloOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([soloOwner, vaultTokenKp])
        .rpc();

      const vault = await sdk.fetchVault(soloVaultPda);
      soloVaultTokenAccount = vault.tokenAccount;

      // Fund with USDC
      await mintTo(
        provider.connection,
        soloOwner,
        soloMint,
        soloVaultTokenAccount,
        soloOwner,
        200_000_000 // 200 USDC
      );
    });

    it("1-of-1 vault: propose and immediately execute in two transactions", async () => {
      // Propose (auto-approved, threshold=1 met immediately)
      await program.methods
        .proposeTransfer(
          new BN(50_000_000), // 50 USDC
          soloRecipientTokenAccount, // recipient's token account owner
          "solo transfer"
        )
        .accountsPartial({
          vault: soloVaultPda,
          proposal: sdk.getProposalPda(soloVaultPda, 0),
          proposer: soloOwner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([soloOwner])
        .rpc();

      const proposal = await sdk.fetchProposal(soloVaultPda, 0);
      assert.equal(proposal.approvals.length, 1);
      // threshold = 1 met, can execute immediately

      const [proposalPda] = findProposalPda(soloVaultPda, 0, program.programId);

      const recipientBefore = await getAccount(provider.connection, soloRecipientTokenAccount);

      await program.methods
        .executeTransfer()
        .accountsPartial({
          vault: soloVaultPda,
          proposal: proposalPda,
          vaultTokenAccount: soloVaultTokenAccount,
          destinationTokenAccount: soloRecipientTokenAccount,
          executor: soloOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([soloOwner])
        .rpc();

      const recipientAfter = await getAccount(provider.connection, soloRecipientTokenAccount);
      assert.equal(
        recipientAfter.amount - recipientBefore.amount,
        BigInt(50_000_000)
      );
    });
  });

  // ─── Boundary Value Tests ─────────────────────────────────────────────────

  describe("boundary values", () => {
    it("rejects duplicate approvers", async () => {
      const dupOwner = Keypair.generate();
      const dupMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
      await airdrop(provider, dupOwner.publicKey);
      const dupTokenKp = Keypair.generate();

      await assertError(async () => {
        await program.methods
          .initializeVault(
            1,
            [dupOwner.publicKey, dupOwner.publicKey], // duplicate
            new BN(0)
          )
          .accountsPartial({
            vault: sdk.getVaultPda(dupOwner.publicKey, dupMint),
            vaultTokenAccount: dupTokenKp.publicKey,
            usdcMint: dupMint,
            owner: dupOwner.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([dupOwner, dupTokenKp])
          .rpc();
      }, "ApproverAlreadyExists");
    });

    it("transfer_limit = 0 means unlimited (allows any amount)", async () => {
      // Use main vault which has 1B limit, first create an unlimited vault
      const unlimOwner = Keypair.generate();
      const unlimMint = await createMint(provider.connection, owner, owner.publicKey, null, 6);
      await airdrop(provider, unlimOwner.publicKey);
      const unlimTokenKp = Keypair.generate();

      await program.methods
        .initializeVault(
          1,
          [unlimOwner.publicKey],
          new BN(0) // 0 = unlimited
        )
        .accountsPartial({
          vault: sdk.getVaultPda(unlimOwner.publicKey, unlimMint),
          vaultTokenAccount: unlimTokenKp.publicKey,
          usdcMint: unlimMint,
          owner: unlimOwner.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([unlimOwner, unlimTokenKp])
        .rpc();

      const [unlimVaultPda] = findVaultPda(unlimOwner.publicKey, unlimMint, program.programId);
      const vault = await sdk.fetchVault(unlimVaultPda);
      assert.equal(vault.transferLimit.toNumber(), 0);

      // Propose a very large transfer (should succeed since limit=0)
      const largeDest = Keypair.generate().publicKey;
      await program.methods
        .proposeTransfer(
          new BN("999999999999"), // huge amount
          largeDest,
          "unlimited test"
        )
        .accountsPartial({
          vault: unlimVaultPda,
          proposal: sdk.getProposalPda(unlimVaultPda, 0),
          proposer: unlimOwner.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([unlimOwner])
        .rpc();

      const proposal = await sdk.fetchProposal(unlimVaultPda, 0);
      assert.equal(proposal.amount.toString(), "999999999999");
    });

    it("rejects transfer of limit + 1", async () => {
      // Main vault has 1B (1_000_000_000) limit
      await assertError(async () => {
        const nextIdx = (await sdk.fetchVault(vaultPda)).proposalCount.toNumber();
        await program.methods
          .proposeTransfer(
            new BN(1_000_000_001), // 1 over limit
            recipient.publicKey,
            "over limit"
          )
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, nextIdx),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "ExceedsTransferLimit");
    });

    it("allows transfer of exactly the limit", async () => {
      const nextIdx = (await sdk.fetchVault(vaultPda)).proposalCount.toNumber();
      await program.methods
        .proposeTransfer(
          new BN(1_000_000_000), // exactly the limit
          recipient.publicKey,
          "exact limit"
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, nextIdx),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      const proposal = await sdk.fetchProposal(vaultPda, nextIdx);
      assert.equal(proposal.amount.toString(), "1000000000");
    });

    it("rejects empty memo string (memo length 0 is valid)", async () => {
      const nextIdx = (await sdk.fetchVault(vaultPda)).proposalCount.toNumber();
      // Empty memo should be valid
      await program.methods
        .proposeTransfer(
          new BN(100_000_000),
          recipient.publicKey,
          "" // empty memo
        )
        .accountsPartial({
          vault: vaultPda,
          proposal: sdk.getProposalPda(vaultPda, nextIdx),
          proposer: approver1.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([approver1])
        .rpc();

      const proposal = await sdk.fetchProposal(vaultPda, nextIdx);
      assert.equal(proposal.memo, "");
    });

    it("rejects memo exceeding 64 bytes", async () => {
      const nextIdx = (await sdk.fetchVault(vaultPda)).proposalCount.toNumber();
      const longMemo = "A".repeat(65);

      await assertError(async () => {
        await program.methods
          .proposeTransfer(
            new BN(100_000),
            recipient.publicKey,
            longMemo
          )
          .accountsPartial({
            vault: vaultPda,
            proposal: sdk.getProposalPda(vaultPda, nextIdx),
            proposer: approver1.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([approver1])
          .rpc();
      }, "MemoTooLong");
    });

    it("non-approver cannot execute even with enough approvals", async () => {
      // outsider is not an approver on the main vault
      const nextIdx = (await sdk.fetchVault(vaultPda)).proposalCount.toNumber() - 1;
      // Try to execute an existing proposal as outsider
      const [proposalPda] = findProposalPda(vaultPda, 0, program.programId);

      await assertError(async () => {
        await program.methods
          .executeTransfer()
          .accountsPartial({
            vault: vaultPda,
            proposal: proposalPda,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: recipientTokenAccount,
            executor: outsider.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([outsider])
          .rpc();
      }, "NotAnApprover");
    });
  });
});
