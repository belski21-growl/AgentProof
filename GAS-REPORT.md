# AgentProof — Gas Report

Measured 19 Nov 2026 on a local Anvil chain (Foundry 1.9.0, solc 0.8.26,
optimizer on, 200 runs, EVM version `paris`). Two independent methods
agree: `forge test` harness numbers and real `cast send` transactions
against a deployed instance on Anvil.

BNB price reference: Rp10,741,440 / BNB (CoinGecko, 19 Nov 2026 15:53 WIB).
User wallet balance at the time: ~0.00204 BNB (~Rp21,950).

## Measured gas

| Operation | Gas (measured) | Method |
| --- | --- | --- |
| Deploy `AgentProof` | 452,201 | `forge script` broadcast receipt, Anvil |
| Deploy `MockAgentId` | 167,505 | `forge script` broadcast receipt, Anvil (testnet/demo only) |
| Deploy both (testnet mode) | 619,706 | sum of the two receipts |
| `attest` first-ever call (agent's 1st attest, new contract) | 230,746 | `cast send` receipt |
| `attest` first call, same agent, 2nd+ contract | 196,558 | `cast send` receipt |
| `attest` update call (same agent + contract) | 42,816 | `cast send` receipt |
| `attest` first call (forge test harness) | 237,989 | `forge test` gasleft delta |
| `attest` update call (forge test harness) | 43,553 | `forge test` gasleft delta |

The forge-harness numbers run ~7k higher than real transactions (test
harness overhead). The `cast send` figures are the ones to budget with.

Why a first attest costs ~231k: it writes ~9 cold storage slots (packed
attestation struct x2 slots, per-contract count, global list length +
element, per-agent list length + element, per-agent index). Later
first-attests by the same agent cost ~197k (the agent's own list-length
slot is already non-zero). Updates are cheap (~43k) because all slots
are already warm and non-zero.

## Mainnet budget vs the user's hard cap

Hard cap (user, 19 Nov 2026 ~16:30): total mainnet spend **max 0.0015 BNB
(~Rp16,000)**; balance after all spend **must stay ≥ Rp5,000**; deploy
**only at gas ≤ 1 gwei** (wait if higher); seed attestations max 10 and
only if room remains under the cap.

At exactly 1 gwei, 0.0015 BNB = 1,500,000 gas of budget.

| Scenario (@ 1 gwei) | Gas | Cost (BNB) | Balance after | Verdict |
| --- | --- | --- | --- | --- |
| Deploy only | 452,201 | 0.000452201 | ~0.001587799 (~Rp17,054) | fits, wide margin |
| Deploy + 4 seed attestations | 1,272,621 | 0.001272621 | ~0.000767379 (~Rp8,243) | fits, comfortable |
| Deploy + 5 seed attestations | 1,469,179 | 0.001469179 | ~0.000570821 (~Rp6,133) | fits, thin margin |
| Deploy + 6 seed attestations | 1,665,737 | 0.001665737 | ~0.000374263 (~Rp4,020) | **OVER cap + below Rp5,000 floor** |

Seed attestation gas assumes one agent (the user) attesting new
contracts: 1st seed 230,746 + each further seed 196,558.

**Conclusion: with the current design, at most 5 seed attestations fit
under the cap, and 4 is the comfortable number.** The 10-seed maximum
the user allowed cannot be reached under this cap with this contract —
that is a deliberate trade-off to report, not a number to force.

## Options if more seeds are wanted (decision for the parent, not taken)

- **Slim design (events-only discovery):** drop the on-chain global +
  per-agent enumeration lists and discover attested contracts from the
  `Attested` events instead. Estimated saving ~80k gas per first attest
  (unmeasured estimate — would need a rebuild + re-test to confirm).
  Cost: the website reads events instead of contract calls, and the
  contract loses its on-chain enumeration getters. Would allow ~6–7
  seeds under the cap.
- **Wait for lower gas:** the cap math above is at 1 gwei; BSC gas is
  often at or below 1 gwei, but if it is above, the rule is to wait.
- **Fewer seeds:** 0 seeds is always valid — the registry launches
  empty and other Agent ID holders fill it.

## Testnet deployment — measured on BSC testnet (chain 97), 19 Nov 2026 ~17:05–17:25 WIB

Deployed from the general testnet wallet `0x3c19…3245D` (starting balance
0.11 tBNB, ending balance 0.10990412372 tBNB — total spent
0.00009587628 tBNB, $0 value). RPC: publicnode for deploy, dataseed for
the attest replacement (see note below). All receipts verified on-chain
via `cast receipt` / `cast call`.

| Operation | Gas (measured) | Tx hash | Block |
| --- | --- | --- | --- |
| Deploy `MockAgentId` | 167,505 | `0x1adf78052d6e537eae415c33e4b44967621a3e2dab023770b42e563258240a91` | 143616955 |
| Deploy `AgentProof` | 452,201 | `0x3099d87eb51fd4e3bb4dac3cc2ab1d3c0f2d1d30727815b8053a8b81c211e26e` | 143616955 |
| Deploy both (testnet mode) | 619,706 | — | — |
| Mint mock Agent ID (token #1, replacement tx) | 90,259 | `0x9be07eb035a0321ac3259c400f5958f592fb60073b848222a913a9c55a5c9371` | 143617196 |
| `attest` first-ever call (ContextGraph, SAFE) | 230,746 | `0x30389a2bc688a4fdd023fdd8ef92a07e8b2005b5b1a56f81d8fc22f7822d9c3f` | 143620541 |

**Anvil vs testnet: identical.** Deploy gas (452,201 / 167,505) and the
first-attest gas (230,746) match the Anvil measurements exactly — the
mainnet budget table above can be trusted as measured, not estimated.

**Gas price actually paid:** deploy txs at 0.1 gwei; mint replacement
effective 0.12 gwei; attest effective 0.1 gwei. At these prices the whole
testnet run cost under 0.0001 tBNB.

**RPC note (worth knowing for mainnet):** two `cast send` calls via
`bsc-testnet.publicnode.com` broadcast but sat unconfirmed in that node's
mempool for 5+ minutes (nonce pending 4 vs latest 3 on publicnode, while
dataseed showed pending = latest = 3 — the tx never propagated). Both
were recovered by re-sending as replacements with explicit nonce and
higher gas price via `data-seed-prebsc-1-s1.binance.org:8545`, which
confirmed within ~20 s. Lesson: if a BSC tx stalls on one RPC, check the
nonce on a second RPC before assuming it is mined; a stuck tx is
replaceable by nonce.

**BscScan testnet verification: FAILED (not verified).** Both contracts
remain unverified on testnet BscScan as of this run. Attempts and exact
errors:
- `forge verify-contract` (MockAgentId): Sourcify endpoint timed out
  after 5 retries, then Etherscan V2 returned `NOTOK / Invalid API Key
  (#err2)` — the stored-key surrogate is not swapped for forge's direct
  HTTPS request.
- `forge verify-contract` (AgentProof): `Failed to obtain contract ABI`
  — connection to `api.etherscan.io/v2/api` timed out.
- Direct Etherscan V2 API `verifysourcecode` (chainid=97, via the
  connector's Python helper with the stored key — reads on the same key
  return `status: 1, OK`): `{"status":"0","message":"NOTOK","result":"Error!"}`
  for both contracts, and the same generic error for a deliberately
  wrong compiler version — the submit endpoint itself rejects the call
  regardless of content. `curl` POST gives the identical response.
  Likely cause: the free API plan does not cover verification submits
  on V2 for this chain. Source is published in the repo; verification
  can be redone from the user's browser (testnet BscScan manual verify)
  or with a paid Etherscan plan key.

**Seed attestation (testnet):** ContextGraph Nodes
`0x08b1323a74530BEDd2188b458eBcC856315d8E0f`, verdict **SAFE (0)**,
evidenceHash `0xaf53ecf6a638a5467f33b3d5dbcecd7d421f9fd490aba8b59112c2f422f43521`
(keccak of the verification note). Verified on-chain:
`attestationCount = 1`, `getAttestation` returns verdict 0, the same
evidenceHash, `exists = true`.

## Caveats

- Anvil gas ≈ BSC mainnet gas for these calls (same EVM gas schedule
  for the opcodes used). Expect variance of a few percent from
  warm/cold state of the specific addresses involved.
- The deploy script in mainnet mode deploys AgentProof ONLY (the mock
  is skipped when `AGENT_ID_CONTRACT` is set — verified on Anvil:
  1 tx, 452,201 gas). Deploying the mock on mainnet as well would waste
  167,505 gas and is never done.
- Mock deployment (167,505 gas) applies to testnet only and costs
  valueless tBNB.
