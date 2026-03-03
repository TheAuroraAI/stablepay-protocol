use anchor_lang::prelude::*;
use crate::{constants::*, error::StablePayError, state::{TransferProposal, Vault}};

#[derive(Accounts)]
pub struct ApproveTransfer<'info> {
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

    pub approver: Signer<'info>,
}

pub fn handler(ctx: Context<ApproveTransfer>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let proposal = &mut ctx.accounts.proposal;

    require!(!vault.paused, StablePayError::VaultPaused);
    require!(vault.is_approver(&ctx.accounts.approver.key()), StablePayError::NotAnApprover);
    require!(!proposal.executed, StablePayError::ProposalAlreadyExecuted);
    require!(!proposal.cancelled, StablePayError::ProposalCancelled);
    require!(!proposal.has_approved(&ctx.accounts.approver.key()), StablePayError::AlreadyApproved);

    proposal.approvals.push(ctx.accounts.approver.key());

    msg!(
        "Approval added on proposal #{}: {}/{} approvals",
        proposal.index, proposal.approvals.len(), vault.threshold
    );
    Ok(())
}
