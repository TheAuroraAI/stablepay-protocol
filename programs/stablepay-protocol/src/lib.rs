pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF");

#[program]
pub mod stablepay_protocol {
    use super::*;

    /// Initialize a new multi-sig USDC vault with threshold-based approvals
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        threshold: u8,
        approvers: Vec<Pubkey>,
        transfer_limit: u64,
    ) -> Result<()> {
        initialize::handler(ctx, threshold, approvers, transfer_limit)
    }

    /// Create a transfer proposal (proposer auto-approves)
    pub fn propose_transfer(
        ctx: Context<ProposeTransfer>,
        amount: u64,
        destination: Pubkey,
        memo: String,
    ) -> Result<()> {
        propose_transfer::handler(ctx, amount, destination, memo)
    }

    /// Add approval to a pending proposal
    pub fn approve_transfer(ctx: Context<ApproveTransfer>) -> Result<()> {
        approve_transfer::handler(ctx)
    }

    /// Execute a proposal that has reached threshold
    pub fn execute_transfer(ctx: Context<ExecuteTransfer>) -> Result<()> {
        execute_transfer::handler(ctx)
    }

    /// Cancel a pending proposal (proposer or owner only)
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        cancel_proposal::handler(ctx)
    }

    /// Pause or unpause the vault (owner only)
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        compliance::set_paused_handler(ctx, paused)
    }

    /// Set maximum transfer limit per proposal (owner only)
    pub fn set_transfer_limit(ctx: Context<SetTransferLimit>, limit: u64) -> Result<()> {
        compliance::set_transfer_limit_handler(ctx, limit)
    }

    /// Add an address to the allowlist (owner only)
    pub fn add_to_allowlist(ctx: Context<AddToAllowlist>, address: Pubkey) -> Result<()> {
        compliance::add_to_allowlist_handler(ctx, address)
    }

    /// Remove an address from the allowlist (owner only)
    pub fn remove_from_allowlist(ctx: Context<RemoveFromAllowlist>, address: Pubkey) -> Result<()> {
        compliance::remove_from_allowlist_handler(ctx, address)
    }
}
