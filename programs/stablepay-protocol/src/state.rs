use anchor_lang::prelude::*;

/// A multi-sig USDC vault with compliance controls
#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub usdc_mint: Pubkey,
    pub token_account: Pubkey,
    pub approvers: Vec<Pubkey>,
    pub threshold: u8,
    pub proposal_count: u64,
    pub transfer_limit: u64,
    pub paused: bool,
    pub allowlist_enabled: bool,
    pub allowlist: Vec<Pubkey>,
    pub bump: u8,
}

impl Vault {
    pub const MAX_APPROVERS: usize = 10;
    pub const MAX_ALLOWLIST: usize = 20;

    pub fn space() -> usize {
        8 + 32 + 32 + 32 +
        (4 + 32 * Self::MAX_APPROVERS) +
        1 + 8 + 8 + 1 + 1 +
        (4 + 32 * Self::MAX_ALLOWLIST) +
        1
    }

    pub fn is_approver(&self, key: &Pubkey) -> bool {
        self.approvers.contains(key)
    }

    pub fn is_allowed_destination(&self, dest: &Pubkey) -> bool {
        if !self.allowlist_enabled {
            return true;
        }
        self.allowlist.contains(dest)
    }
}

/// A transfer proposal awaiting multi-sig approval
#[account]
pub struct TransferProposal {
    pub vault: Pubkey,
    pub index: u64,
    pub destination: Pubkey,
    pub amount: u64,
    pub memo: String,
    pub proposer: Pubkey,
    pub approvals: Vec<Pubkey>,
    pub executed: bool,
    pub cancelled: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl TransferProposal {
    pub const MAX_MEMO_LEN: usize = 64;

    pub fn space() -> usize {
        8 + 32 + 8 + 32 + 8 +
        (4 + Self::MAX_MEMO_LEN) +
        32 +
        (4 + 32 * Vault::MAX_APPROVERS) +
        1 + 1 + 8 + 1
    }

    pub fn has_approved(&self, approver: &Pubkey) -> bool {
        self.approvals.contains(approver)
    }
}
