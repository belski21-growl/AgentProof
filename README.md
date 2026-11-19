# AgentProof

On-chain registry where Agent ID holders attest free-mint NFT contracts
they have security-verified. Each attestation is bound to the attesting
agent's address (the holder of an Agent ID), and anyone can read the
registry for free.

Built for the Agent ID Hackathon (Binance Wallet x BNB Chain).
One project, one contract, no owner, no token, no promised returns.

## The problem

The Agent ID community is flooded with free mints. Most are templates,
scams, or projects with no website at all — and there is no public,
on-chain record of which contracts have actually been checked by someone.
AgentProof turns real verification work into a public good: an agent
checks a contract, attests a verdict on-chain, and anyone can look it up
before minting.

## How it works

- `attest(nftContract, verdict, evidenceHash)` — only addresses holding
  at least one Agent ID can call it. The gate is an on-chain
  `balanceOf(msg.sender) > 0` check against the Agent ID token contract.
- Verdicts: `0 = SAFE` (ok to mint), `1 = HOLD` (needs more checks),
  `2 = BLOCK` (template or scam).
- `evidenceHash` is a `bytes32` hash of the off-chain verification
  evidence (e.g. keccak256 of a report). No report text is stored
  on-chain — only the hash.
- One attestation per agent per contract. Re-attesting updates your own
  entry (verdict, evidence, timestamp). Counts and list positions never
  change on update.
- Every attest emits `Attested(agent, nftContract, verdict,
  evidenceHash, timestamp)` so the list of attested contracts can be
  discovered from events without any storage reads.

Reads (all free, off-chain): `getAttestation`, `attestationCount`,
`hasAttested`, `attestedContractsCount`, `attestedContractAt`,
`contractsAttestedBy`, plus the public `agentIdContract` getter.

## Why there is no owner

There is deliberately NO owner, admin, pause, upgrade, or rescue
function. Nobody can censor, pause, alter, or delete an attestation once
written; only the attesting agent can update their own entry. This is a
trust choice, documented here so judges and users can verify it from the
source: the contract does exactly what it says and nothing else.

## Agent ID integration

- Access control: only Agent ID holders can attest (on-chain
  `balanceOf` gate, checked on every call).
- Identity: attestations are bound to the holder's address. The `.ai`
  name is resolved off-chain from the address — the contract never
  implements name-to-address lookup (that use is explicitly out of
  scope for this project).
- The Agent ID contract address is an `immutable` set in the
  constructor, so the same code runs against the real Agent ID token on
  mainnet and against a mock on testnet. Mainnet address (SPACE ID,
  ERC-721, non-transferable):
  `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`.

## Hackathon red-line compliance

- No QR-code / pairing-code login for any wallet on the website.
  Wallet connection is injected-wallet only, and every attest is a
  transaction the user sees and confirms in their own wallet.
- No transaction-confirmation bypass, no unlimited approvals, no asset
  transfers, no collection of seed phrases, private keys, API secrets,
  or pairing codes.
- No promised returns anywhere in the code, docs, or website.
- The project name and domain contain no "Binance" / "BNB".
- Contract is open-source, no hidden permissions (there are none to
  disclose — see "Why there is no owner" above).

## Build / test

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test -vv
```

12 tests, all passing. They cover: non-holder revert, exact stored
values, update semantics, second-holder counting, invalid verdict /
zero address reverts, enumeration order, and the mock Agent ID.

## Deploy

```bash
# Testnet demo (deploys MockAgentId + AgentProof):
forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast \
  --private-key <runtime-key>

# Mainnet (deploys AgentProof ONLY, using the real Agent ID contract):
AGENT_ID_CONTRACT=0x60b9262456de011f7d15a54cdd8c48baaa8b022f \
  forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast \
  --private-key <runtime-key>
```

The deploy script never reads a private key from a file; the signer is
supplied at runtime. Gas figures: see [GAS-REPORT.md](GAS-REPORT.md).

## Verify on BscScan

After deployment, verify the source on BscScan (testnet or mainnet) so
anyone can read it:

```bash
forge verify-contract <AgentProof address> src/AgentProof.sol:AgentProof \
  --chain-id 56 --etherscan-api-key <key> \
  --constructor-args $(cast abi-encode "constructor(address)" <agent-id-address>)
```

(Use `--chain-id 97` for BSC testnet.)

## Project layout

```text
src/AgentProof.sol    # the registry (no imports, no owner)
src/MockAgentId.sol   # TEST ONLY stand-in for the Agent ID token
test/AgentProof.t.sol # 12 Foundry tests
script/Deploy.s.sol   # deploy script (env-var Agent ID address)
web/                  # static website (read from events, attest via injected wallet)
```

## License

MIT.
