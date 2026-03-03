use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{constants::*, error::StablePayError, state::Vault};

#[derive(Accounts)]
#[instruction(threshold: u8, approvers: Vec<Pubkey>)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = Vault::space(),
        seeds = [VAULT_SEED, owner.key().as_ref(), usdc_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<InitializeVault>,
    threshold: u8,
    approvers: Vec<Pubkey>,
    transfer_limit: u64,
) -> Result<()> {
    require!(!approvers.is_empty(), StablePayError::InvalidThreshold);
    require!(
        threshold >= 1 && threshold as usize <= approvers.len(),
        StablePayError::InvalidThreshold
    );
    require!(
        approvers.len() <= Vault::MAX_APPROVERS,
        StablePayError::ApproversFull
    );

    let vault = &mut ctx.accounts.vault;
    let bump = ctx.bumps.vault;

    vault.owner = ctx.accounts.owner.key();
    vault.usdc_mint = ctx.accounts.usdc_mint.key();
    vault.token_account = ctx.accounts.vault_token_account.key();
    vault.approvers = approvers;
    vault.threshold = threshold;
    vault.proposal_count = 0;
    vault.transfer_limit = transfer_limit;
    vault.paused = false;
    vault.allowlist_enabled = false;
    vault.allowlist = Vec::new();
    vault.bump = bump;

    msg!("StablePay vault initialized: threshold={}/{}", threshold, vault.approvers.len());
    Ok(())
}
