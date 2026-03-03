use anchor_lang::prelude::*;
use crate::{constants::*, error::StablePayError, state::{TransferProposal, Vault}};

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [
            PROPOSAL_SEED,
            vault.key().as_ref(),
            &proposal.index.to_le_bytes()
        ],
        bump = proposal.bump,
        constraint = proposal.vault == vault.key(),
    )]
    pub proposal: Account<'info, TransferProposal>,

    /// Proposer or vault owner can cancel
    pub canceller: Signer<'info>,
}

pub fn handler(ctx: Context<CancelProposal>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let vault = &ctx.accounts.vault;
    let canceller = ctx.accounts.canceller.key();

    require!(!proposal.executed, StablePayError::ProposalAlreadyExecuted);
    require!(!proposal.cancelled, StablePayError::ProposalCancelled);
    require!(
        canceller == proposal.proposer || canceller == vault.owner,
        StablePayError::NotProposer
    );

    proposal.cancelled = true;
    msg!("Proposal #{} cancelled", proposal.index);
    Ok(())
}
