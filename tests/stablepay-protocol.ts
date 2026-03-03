import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { StablepayProtocol } from "../target/types/stablepay_protocol";

describe("stablepay-protocol", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.stablepayProtocol as Program<StablepayProtocol>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
