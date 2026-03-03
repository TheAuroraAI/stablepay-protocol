use anchor_lang::prelude::*;
use crate::{constants::*, error::StablePayError, state::Vault};

/// Toggle pause state (owner only)
#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key(),
    )]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

pub fn set_paused_handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.vault.paused = paused;
    msg!("Vault paused={}", paused);
    Ok(())
}

/// Set per-transfer limit (owner only)
#[derive(Accounts)]
pub struct SetTransferLimit<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key(),
    )]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

pub fn set_transfer_limit_handler(ctx: Context<SetTransferLimit>, limit: u64) -> Result<()> {
    ctx.accounts.vault.transfer_limit = limit;
    msg!("Transfer limit set to {} USDC lamports", limit);
    Ok(())
}

/// Add address to allowlist (owner only)
#[derive(Accounts)]
pub struct AddToAllowlist<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key(),
    )]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

pub fn add_to_allowlist_handler(ctx: Context<AddToAllowlist>, address: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.allowlist.len() < Vault::MAX_ALLOWLIST,
        StablePayError::AllowlistFull
    );
    if !vault.allowlist.contains(&address) {
        vault.allowlist.push(address);
    }
    vault.allowlist_enabled = true;
    msg!("Added {} to allowlist ({} total)", address, vault.allowlist.len());
    Ok(())
}

/// Remove address from allowlist (owner only)
#[derive(Accounts)]
pub struct RemoveFromAllowlist<'info> {
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), vault.usdc_mint.as_ref()],
        bump = vault.bump,
        constraint = vault.owner == owner.key(),
    )]
    pub vault: Account<'info, Vault>,

    pub owner: Signer<'info>,
}

pub fn remove_from_allowlist_handler(
    ctx: Context<RemoveFromAllowlist>,
    address: Pubkey,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.allowlist.retain(|a| a != &address);
    if vault.allowlist.is_empty() {
        vault.allowlist_enabled = false;
    }
    msg!("Removed {} from allowlist", address);
    Ok(())
}
