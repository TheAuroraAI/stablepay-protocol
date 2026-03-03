/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stablepay_protocol.json`.
 */
export type StablepayProtocol = {
  "address": "Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF",
  "metadata": {
    "name": "stablepayProtocol",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "addToAllowlist",
      "docs": [
        "Add an address to the allowlist (owner only)"
      ],
      "discriminator": [
        149,
        143,
        78,
        134,
        241,
        244,
        7,
        56
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "address",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "approveTransfer",
      "docs": [
        "Add approval to a pending proposal"
      ],
      "discriminator": [
        198,
        217,
        247,
        150,
        208,
        60,
        169,
        244
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.index",
                "account": "transferProposal"
              }
            ]
          }
        },
        {
          "name": "approver",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "cancelProposal",
      "docs": [
        "Cancel a pending proposal (proposer or owner only)"
      ],
      "discriminator": [
        106,
        74,
        128,
        146,
        19,
        65,
        39,
        23
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.index",
                "account": "transferProposal"
              }
            ]
          }
        },
        {
          "name": "canceller",
          "docs": [
            "Proposer or vault owner can cancel"
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "executeTransfer",
      "docs": [
        "Execute a proposal that has reached threshold"
      ],
      "discriminator": [
        233,
        126,
        160,
        184,
        235,
        206,
        31,
        119
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "proposal.index",
                "account": "transferProposal"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "destinationTokenAccount",
          "writable": true
        },
        {
          "name": "executor",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initializeVault",
      "docs": [
        "Initialize a new multi-sig USDC vault with threshold-based approvals"
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "threshold",
          "type": "u8"
        },
        {
          "name": "approvers",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "transferLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "proposeTransfer",
      "docs": [
        "Create a transfer proposal (proposer auto-approves)"
      ],
      "discriminator": [
        140,
        86,
        133,
        124,
        253,
        226,
        251,
        195
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "vault.proposal_count",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "proposer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "destination",
          "type": "pubkey"
        },
        {
          "name": "memo",
          "type": "string"
        }
      ]
    },
    {
      "name": "removeFromAllowlist",
      "docs": [
        "Remove an address from the allowlist (owner only)"
      ],
      "discriminator": [
        45,
        46,
        214,
        56,
        189,
        77,
        242,
        227
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "address",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setPaused",
      "docs": [
        "Pause or unpause the vault (owner only)"
      ],
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTransferLimit",
      "docs": [
        "Set maximum transfer limit per proposal (owner only)"
      ],
      "discriminator": [
        209,
        173,
        16,
        48,
        255,
        244,
        136,
        237
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  98,
                  108,
                  101,
                  112,
                  97,
                  121,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.usdc_mint",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "limit",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "transferProposal",
      "discriminator": [
        4,
        63,
        123,
        17,
        197,
        223,
        149,
        175
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "vaultPaused",
      "msg": "Vault is paused"
    },
    {
      "code": 6001,
      "name": "invalidThreshold",
      "msg": "Threshold must be >= 1 and <= number of approvers"
    },
    {
      "code": 6002,
      "name": "notAnApprover",
      "msg": "Not an approver on this vault"
    },
    {
      "code": 6003,
      "name": "notOwner",
      "msg": "Not the vault owner"
    },
    {
      "code": 6004,
      "name": "exceedsTransferLimit",
      "msg": "Transfer amount exceeds vault limit"
    },
    {
      "code": 6005,
      "name": "destinationNotAllowed",
      "msg": "Destination not in allowlist"
    },
    {
      "code": 6006,
      "name": "alreadyApproved",
      "msg": "Already approved this proposal"
    },
    {
      "code": 6007,
      "name": "proposalAlreadyExecuted",
      "msg": "Proposal already executed"
    },
    {
      "code": 6008,
      "name": "proposalCancelled",
      "msg": "Proposal was cancelled"
    },
    {
      "code": 6009,
      "name": "insufficientApprovals",
      "msg": "Insufficient approvals to execute"
    },
    {
      "code": 6010,
      "name": "notProposer",
      "msg": "Not the proposer"
    },
    {
      "code": 6011,
      "name": "approversFull",
      "msg": "Approvers list is full (max 10)"
    },
    {
      "code": 6012,
      "name": "allowlistFull",
      "msg": "Allowlist is full (max 20)"
    },
    {
      "code": 6013,
      "name": "approverAlreadyExists",
      "msg": "Approver already exists"
    },
    {
      "code": 6014,
      "name": "memoTooLong",
      "msg": "Memo too long (max 64 bytes)"
    }
  ],
  "types": [
    {
      "name": "transferProposal",
      "docs": [
        "A transfer proposal awaiting multi-sig approval"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "memo",
            "type": "string"
          },
          {
            "name": "proposer",
            "type": "pubkey"
          },
          {
            "name": "approvals",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "executed",
            "type": "bool"
          },
          {
            "name": "cancelled",
            "type": "bool"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "A multi-sig USDC vault with compliance controls"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "tokenAccount",
            "type": "pubkey"
          },
          {
            "name": "approvers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "threshold",
            "type": "u8"
          },
          {
            "name": "proposalCount",
            "type": "u64"
          },
          {
            "name": "transferLimit",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "allowlistEnabled",
            "type": "bool"
          },
          {
            "name": "allowlist",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "proposalSeed",
      "type": "bytes",
      "value": "[115, 116, 97, 98, 108, 101, 112, 97, 121, 45, 112, 114, 111, 112, 111, 115, 97, 108]"
    },
    {
      "name": "vaultSeed",
      "type": "bytes",
      "value": "[115, 116, 97, 98, 108, 101, 112, 97, 121, 45, 118, 97, 117, 108, 116]"
    }
  ]
};
