use anchor_lang::prelude::*;
use crate::{constants::*, error::StablePayError, state::{TransferProposal, Vault}};

#[derive(Accounts)]
#[instruction(amount: u64, destination: Pubkey, memo: String)]
pub struct ProposeTransfer<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = proposer,
        space = TransferProposal::space(),
        seeds = [
            PROPOSAL_SEED,
            vault.key().as_ref(),
            &vault.proposal_count.to_le_bytes()
        ],
        bump,
    )]
    pub proposal: Account<'info, TransferProposal>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ProposeTransfer>,
    amount: u64,
    destination: Pubkey,
    memo: String,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    require!(!vault.paused, StablePayError::VaultPaused);
    require!(vault.is_approver(&ctx.accounts.proposer.key()), StablePayError::NotAnApprover);
    require!(memo.len() <= TransferProposal::MAX_MEMO_LEN, StablePayError::MemoTooLong);

    if vault.transfer_limit > 0 {
        require!(amount <= vault.transfer_limit, StablePayError::ExceedsTransferLimit);
    }

    require!(
        vault.is_allowed_destination(&destination),
        StablePayError::DestinationNotAllowed
    );

    let proposal = &mut ctx.accounts.proposal;
    let bump = ctx.bumps.proposal;
    let index = vault.proposal_count;

    proposal.vault = vault.key();
    proposal.index = index;
    proposal.destination = destination;
    proposal.amount = amount;
    proposal.memo = memo;
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.approvals = vec![ctx.accounts.proposer.key()]; // auto-approve by proposer
    proposal.executed = false;
    proposal.cancelled = false;
    proposal.created_at = Clock::get()?.unix_timestamp;
    proposal.bump = bump;

    vault.proposal_count = index.checked_add(1).unwrap();

    msg!(
        "Transfer proposal #{}: {} USDC → {} ({}/{})",
        index, amount, destination, proposal.approvals.len(), vault.threshold
    );
    Ok(())
}
