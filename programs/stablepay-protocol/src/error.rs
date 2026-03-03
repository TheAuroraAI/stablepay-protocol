use anchor_lang::prelude::*;

#[error_code]
pub enum StablePayError {
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Threshold must be >= 1 and <= number of approvers")]
    InvalidThreshold,
    #[msg("Not an approver on this vault")]
    NotAnApprover,
    #[msg("Not the vault owner")]
    NotOwner,
    #[msg("Transfer amount exceeds vault limit")]
    ExceedsTransferLimit,
    #[msg("Destination not in allowlist")]
    DestinationNotAllowed,
    #[msg("Already approved this proposal")]
    AlreadyApproved,
    #[msg("Proposal already executed")]
    ProposalAlreadyExecuted,
    #[msg("Proposal was cancelled")]
    ProposalCancelled,
    #[msg("Insufficient approvals to execute")]
    InsufficientApprovals,
    #[msg("Not the proposer")]
    NotProposer,
    #[msg("Approvers list is full (max 10)")]
    ApproversFull,
    #[msg("Allowlist is full (max 20)")]
    AllowlistFull,
    #[msg("Approver already exists")]
    ApproverAlreadyExists,
    #[msg("Memo too long (max 64 bytes)")]
    MemoTooLong,
}
