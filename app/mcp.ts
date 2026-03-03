/**
 * StablePay Protocol — MCP Server
 *
 * Exposes vault operations as AI-callable tools via the Model Context Protocol.
 * AI agents can manage institutional USDC vaults without custom SDKs.
 *
 * Tools:
 *   stablepay_initialize_vault   — Create multi-sig USDC vault
 *   stablepay_propose_transfer   — Propose a USDC transfer
 *   stablepay_approve_transfer   — Approve a pending proposal
 *   stablepay_execute_transfer   — Execute an approved transfer
 *   stablepay_get_vault          — Read vault state and balance
 *   stablepay_list_proposals     — List all transfer proposals
 *
 * Usage: ts-node app/mcp.ts
 * Protocol: JSON-RPC 2.0 over stdio
 */

import * as readline from "readline";
import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  StablePaySDK,
  findVaultPda,
  findProposalPda,
  type TransferProposalAccount,
} from "../sdk/index";
import type { StablepayProtocol } from "../target/types/stablepay_protocol";
import fs from "fs";
import path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

const CLUSTER = process.env.CLUSTER ?? "devnet";
const RPC_URL =
  process.env.RPC_URL ?? "https://api.devnet.solana.com";

const IDL_PATH = path.join(__dirname, "../target/idl/stablepay_protocol.json");
const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8")) as anchor.Idl;

function loadKeypair(): Keypair {
  const keyPath =
    process.env.KEYPAIR_PATH ??
    path.join(process.env.HOME ?? "/root", ".config", "solana", "id.json");
  try {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf-8")) as number[])
    );
  } catch {
    return Keypair.generate();
  }
}

const connection = new Connection(RPC_URL, "confirmed");
const serverKeypair = loadKeypair();
const provider = new anchor.AnchorProvider(
  connection,
  new anchor.Wallet(serverKeypair),
  { commitment: "confirmed" }
);
anchor.setProvider(provider);

const PROGRAM_ID = new PublicKey(
  idl.address ?? "Ch11Ba993nA8bN2cEnoys7XwxhZxqvA5CCuLb3EwrJjF"
);
const program = new Program<StablepayProtocol>(idl as any, provider);
const sdk = new StablePaySDK(program as any);

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "stablepay_initialize_vault",
    description:
      "Initialize a multi-sig USDC vault on Solana. The server wallet becomes the vault owner. Requires x402 payment (0.05 USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          description: "Number of approvals required to execute transfers (e.g. 2 for 2-of-3)",
        },
        approvers: {
          type: "array",
          items: { type: "string" },
          description: "List of approver Solana public keys (max 10)",
        },
        transferLimit: {
          type: "number",
          description: "Max USDC per transfer in lamports (1 USDC = 1,000,000). 0 = unlimited.",
        },
        usdcMint: {
          type: "string",
          description: "USDC mint address (optional, defaults to devnet USDC)",
        },
      },
      required: ["threshold", "approvers"],
    },
  },
  {
    name: "stablepay_get_vault",
    description: "Read the state and USDC balance of a StablePay vault.",
    inputSchema: {
      type: "object",
      properties: {
        vaultPda: {
          type: "string",
          description: "The vault PDA address",
        },
      },
      required: ["vaultPda"],
    },
  },
  {
    name: "stablepay_propose_transfer",
    description:
      "Propose a USDC transfer from the vault. The proposer auto-approves. Requires x402 payment (0.01 USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        vaultPda: { type: "string", description: "The vault PDA address" },
        amount: {
          type: "number",
          description: "Transfer amount in USDC lamports (1 USDC = 1,000,000)",
        },
        destination: {
          type: "string",
          description: "Recipient Solana wallet address",
        },
        memo: {
          type: "string",
          description: "Optional memo (max 64 bytes)",
        },
      },
      required: ["vaultPda", "amount", "destination"],
    },
  },
  {
    name: "stablepay_approve_transfer",
    description:
      "Add an approval to a pending transfer proposal. Requires x402 payment (0.005 USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        vaultPda: { type: "string", description: "The vault PDA address" },
        proposalIndex: {
          type: "number",
          description: "Index of the proposal to approve",
        },
      },
      required: ["vaultPda", "proposalIndex"],
    },
  },
  {
    name: "stablepay_execute_transfer",
    description:
      "Execute a transfer proposal that has reached its approval threshold. Requires x402 payment (0.01 USDC on Base).",
    inputSchema: {
      type: "object",
      properties: {
        vaultPda: { type: "string", description: "The vault PDA address" },
        proposalIndex: {
          type: "number",
          description: "Index of the approved proposal to execute",
        },
      },
      required: ["vaultPda", "proposalIndex"],
    },
  },
  {
    name: "stablepay_list_proposals",
    description: "List all transfer proposals for a vault.",
    inputSchema: {
      type: "object",
      properties: {
        vaultPda: { type: "string", description: "The vault PDA address" },
      },
      required: ["vaultPda"],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

function parsePubkey(s: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}

function explorerLink(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "stablepay_initialize_vault": {
      const { threshold, approvers, transferLimit, usdcMint: mintStr } = args as any;
      if (typeof threshold !== "number" || threshold < 1) {
        throw new Error("threshold must be a number >= 1");
      }
      if (!Array.isArray(approvers) || approvers.length === 0) {
        throw new Error("approvers must be a non-empty array");
      }

      const approverKeys = (approvers as string[]).map((a) => {
        const k = parsePubkey(a);
        if (!k) throw new Error(`Invalid approver pubkey: ${a}`);
        return k;
      });
      const usdcMintPubkey = mintStr
        ? parsePubkey(String(mintStr))
        : new PublicKey(DEVNET_USDC);
      if (!usdcMintPubkey) throw new Error("Invalid usdcMint");

      const tx = await sdk.initializeVault({
        owner: serverKeypair,
        usdcMint: usdcMintPubkey,
        approvers: approverKeys,
        threshold: threshold as number,
        transferLimit: new BN(transferLimit ?? 0),
      });

      const [vaultPda] = findVaultPda(
        serverKeypair.publicKey,
        usdcMintPubkey,
        PROGRAM_ID
      );

      return {
        vaultPda: vaultPda.toString(),
        txSignature: tx,
        explorer: explorerLink(tx),
        message: `Vault initialized with ${threshold}-of-${approverKeys.length} multi-sig`,
      };
    }

    case "stablepay_get_vault": {
      const vaultKey = parsePubkey(String(args.vaultPda ?? ""));
      if (!vaultKey) throw new Error("Invalid vaultPda");

      const vault = await sdk.fetchVault(vaultKey).catch(() => null);
      if (!vault) throw new Error("Vault not found");

      return {
        vaultPda: vaultKey.toString(),
        owner: vault.owner.toString(),
        threshold: vault.threshold,
        approvers: vault.approvers.map((k: PublicKey) => k.toString()),
        proposalCount: vault.proposalCount.toString(),
        transferLimit: vault.transferLimit.toString(),
        paused: vault.paused,
        allowlistEnabled: vault.allowlistEnabled,
        allowlist: vault.allowlist.map((k: PublicKey) => k.toString()),
      };
    }

    case "stablepay_propose_transfer": {
      const { vaultPda, amount, destination, memo } = args as any;
      const vaultKey = parsePubkey(String(vaultPda ?? ""));
      if (!vaultKey) throw new Error("Invalid vaultPda");
      const destKey = parsePubkey(String(destination ?? ""));
      if (!destKey) throw new Error("Invalid destination pubkey");

      const vaultBefore = await sdk.fetchVault(vaultKey);
      const proposalIndex = vaultBefore.proposalCount.toNumber();

      const tx = await sdk.proposeTransfer({
        vault: vaultKey,
        proposer: serverKeypair,
        amount: new BN(String(amount)),
        destination: destKey,
        memo: String(memo ?? ""),
      });

      const [proposalPda] = findProposalPda(vaultKey, proposalIndex, PROGRAM_ID);
      return {
        proposalPda: proposalPda.toString(),
        proposalIndex,
        txSignature: tx,
        explorer: explorerLink(tx),
        message: `Transfer proposal created. ${vaultBefore.threshold - 1} more approval(s) needed.`,
      };
    }

    case "stablepay_approve_transfer": {
      const { vaultPda, proposalIndex } = args as any;
      const vaultKey = parsePubkey(String(vaultPda ?? ""));
      if (!vaultKey) throw new Error("Invalid vaultPda");

      const tx = await sdk.approveTransfer({
        vault: vaultKey,
        proposalIndex: proposalIndex as number,
        approver: serverKeypair,
      });

      return {
        txSignature: tx,
        explorer: explorerLink(tx),
        message: `Approval added to proposal #${proposalIndex}`,
      };
    }

    case "stablepay_execute_transfer": {
      const { vaultPda, proposalIndex } = args as any;
      const vaultKey = parsePubkey(String(vaultPda ?? ""));
      if (!vaultKey) throw new Error("Invalid vaultPda");

      const proposal = await sdk.fetchProposal(vaultKey, proposalIndex as number);
      const tx = await sdk.executeTransfer({
        vault: vaultKey,
        proposalIndex: proposalIndex as number,
        executor: serverKeypair,
        destinationTokenAccount: proposal.destination,
      });

      return {
        txSignature: tx,
        explorer: explorerLink(tx),
        message: `Transfer executed: ${proposal.amount.toString()} lamports → ${proposal.destination.toString()}`,
      };
    }

    case "stablepay_list_proposals": {
      const vaultKey = parsePubkey(String(args.vaultPda ?? ""));
      if (!vaultKey) throw new Error("Invalid vaultPda");

      const vault = await sdk.fetchVault(vaultKey).catch(() => null);
      if (!vault) throw new Error("Vault not found");

      const proposals = await sdk.fetchAllProposals(vaultKey);
      return {
        vaultPda: vaultKey.toString(),
        totalProposals: vault.proposalCount.toString(),
        proposals: proposals.map((p: TransferProposalAccount, i: number) => ({
          index: i,
          destination: p.destination.toString(),
          amount: p.amount.toString(),
          memo: p.memo,
          approvals: p.approvals.length,
          executed: p.executed,
          cancelled: p.cancelled,
        })),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP JSON-RPC Handler ─────────────────────────────────────────────────────

async function handleRequest(req: any): Promise<any> {
  const { id, method, params } = req;

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: {
              name: "stablepay-mcp",
              version: "1.0.0",
            },
          },
        };

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

      case "tools/call": {
        const { name, arguments: toolArgs } = params;
        const result = await handleTool(name, toolArgs ?? {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ─── Stdio Transport ──────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: any;
  try {
    req = JSON.parse(trimmed);
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }) + "\n"
    );
    return;
  }

  const response = await handleRequest(req);
  process.stdout.write(JSON.stringify(response) + "\n");
});

process.stderr.write(`[StablePay MCP] Listening on stdio (${CLUSTER})\n`);
process.stderr.write(`[StablePay MCP] Program: ${PROGRAM_ID.toString()}\n`);
