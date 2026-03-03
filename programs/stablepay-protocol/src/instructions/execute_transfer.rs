use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as SplTransfer};
use crate::{constants::*, error::StablePayError, state::{TransferProposal, Vault}};

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
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

    #[account(
        mut,
        constraint = vault_token_account.key() == vault.token_account,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: validated via constraint to match proposal.destination
    #[account(
        mut,
        constraint = destination_token_account.owner == proposal.destination,
    )]
    pub destination_token_account: Account<'info, TokenAccount>,

    pub executor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ExecuteTransfer>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let proposal = &mut ctx.accounts.proposal;

    require!(!vault.paused, StablePayError::VaultPaused);
    require!(vault.is_approver(&ctx.accounts.executor.key()), StablePayError::NotAnApprover);
    require!(!proposal.executed, StablePayError::ProposalAlreadyExecuted);
    require!(!proposal.cancelled, StablePayError::ProposalCancelled);
    require!(
        proposal.approvals.len() >= vault.threshold as usize,
        StablePayError::InsufficientApprovals
    );

    // Transfer USDC from vault to destination
    let vault_owner = vault.owner;
    let usdc_mint = vault.usdc_mint;
    let bump = vault.bump;
    let seeds = &[
        VAULT_SEED,
        vault_owner.as_ref(),
        usdc_mint.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplTransfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        proposal.amount,
    )?;

    proposal.executed = true;

    msg!(
        "Executed proposal #{}: {} USDC → {}",
        proposal.index, proposal.amount, proposal.destination
    );
    Ok(())
}
