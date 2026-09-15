# Deploy fee-modified Uniswap V2 to Kaia, BNB Chain, Base, Polygon or Arbitrum

Deploys the **exact bytecode** from the `build/` artifacts of
`uniswap-v2-core` and `uniswap-v2-periphery` (fee changed 0.3% → 0.1%) — no
recompilation, so the Factory's CREATE2 pair addresses stay consistent with the
init code hash hardcoded in `contracts/libraries/UniswapV2Library.sol`. The Pair
bytecode is pure EVM and doesn't depend on chainId, so **the same init code hash
is valid on every network** — only `NETWORK` changes between deployments.

Mainnet only, no testnets — `NETWORK` is required (no default) since every
option below moves real funds.

| `NETWORK` | chain | chainId | native | explorer |
|---|---|---|---|---|
| `kaia` | Kaia | 8217 | KAIA | kaiascan.io |
| `bnb` | BNB Chain | 56 | BNB | bscscan.com |
| `base` | Base | 8453 | ETH | basescan.org |
| `polygon` | Polygon | 137 | POL | polygonscan.com |
| `arbitrum` | Arbitrum One | 42161 | ETH | arbiscan.io |

Full config (RPC / wrapped-native address) per network: [lib.js](lib.js) `NETWORKS`.
Each chain gets its own independent Factory/Router — deploy once per chain by
re-running the steps below with a different `NETWORK`.

## Prerequisites

```bash
# 1. build artifacts must exist in BOTH repos
cd ../../uniswap-v2-core     && yarn && yarn compile
cd ../../uniswap-v2-periphery && yarn && yarn compile

# 2. install this deployer
cd deploy
npm install
cp .env.example .env      # then edit PRIVATE_KEY etc.
```

Fund the deployer address with the target chain's native coin — every network
here is mainnet, so there's no faucet.

## Steps

```bash
# A. verify the init code hash in the library matches the current core build.
#    Must pass before deploying — the deploy script also runs this and aborts on mismatch.
npm run verify:hash

# B. deploy Factory + Router02 (+ optional WETH9), then setFeeTo if FEE_TO is set
npm run deploy
#    -> writes deployments.<network>.json, prints explorer links

# C. live sanity check: creates tokens, adds liquidity, swaps,
#    asserts the CREATE2 pair resolves and the 0.1% fee is in effect
npm run smoke
```

## Create a native-coin / ERC20 pool

`add-liquidity.js` calls `router.addLiquidityETH` — for a new pair it deploys the
pair (CREATE2) and seeds it in one tx. Amounts are human units; token decimals
are read on-chain. The `AMOUNT_NATIVE : AMOUNT_TOKEN` ratio is the pool's starting
price, so match the real market rate.

```bash
# reads deployments.<NETWORK>.json for the Router; approves TOKEN; adds liquidity
NETWORK=kaia \
TOKEN=0xd077a400968890eacc75cdc901f0356c943e4fdb \
AMOUNT_NATIVE=1000 AMOUNT_TOKEN=150 \
npm run add-liquidity
```

For another chain, just change `NETWORK` (and `TOKEN` to that chain's token):

```bash
NETWORK=bnb TOKEN=0x... AMOUNT_NATIVE=2 AMOUNT_TOKEN=600 npm run add-liquidity
```

| var | meaning |
|---|---|
| `TOKEN` | ERC20 to pair with the chain's native coin |
| `AMOUNT_NATIVE` / `AMOUNT_TOKEN` | human-unit amounts; their ratio = initial price (`AMOUNT_KAIA` still works as an alias) |
| `SLIPPAGE_BPS` | min-amount tolerance, default `100` (1%); only bites on an existing pair |

Appends the result to `pools.<network>.json`. `PRIVATE_KEY` is the LP provider
and must hold the native coin + token on that chain.

## .env

| var | meaning |
|---|---|
| `NETWORK` | `kaia` \| `bnb` \| `base` \| `polygon` \| `arbitrum` — see table above. Required, no default |
| `PRIVATE_KEY` | deployer EOA, 0x + 64 hex, funded with that chain's native coin |
| `FEE_TO_SETTER` | can call `factory.setFeeTo` / `setFeeToSetter`; blank = deployer. Permanent control of the developer fee — use a secure key / multisig |
| `FEE_TO` | developer-fee recipient. When set, deploy calls `factory.setFeeTo(FEE_TO)`. Blank = fee stays OFF |
| `WETH_ADDRESS` | blank = canonical wrapped-native address for the network; `deploy` = deploy bundled `WETH9`; `0x…` = explicit |
| `RPC_URL` | optional override of the public endpoint |

## Developer fee (Uniswap V2 protocol fee)

Set `FEE_TO` to route **1/6 of the 0.1% swap fee** to that address. It is
**carved from the LP share, not added on top** — swappers still pay 0.1%
(≈ 0.0833% to LPs, ≈ 0.0167% to `FEE_TO`). It accrues as **LP tokens minted
per pair** on the pair's next `mint`/`burn`; the recipient realises it by
calling `removeLiquidity` on those LP tokens.

- `deploy.js` calls `setFeeTo` automatically only when the deployer **is** the
  `FEE_TO_SETTER`. Otherwise it prints the call to run from that account.
- Fees are **not** captured retroactively — pairs created while the switch was
  off start accruing only after `setFeeTo`. Turn it on before launching pools.
- To change the split from 1/6, edit `rootK.mul(5)` in
  `../../uniswap-v2-core/contracts/UniswapV2Pair.sol` `_mintFee` (share =
  `1/(N+1)`), then recompile and update the init code hash (see below).

Canonical wrapped-native address used when `WETH_ADDRESS` is blank (verified
on-chain — name/symbol/decimals — 2026-09-14):

| network | token | address |
|---|---|---|
| kaia | WKAIA | `0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432` |
| bnb | WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| base | WETH | `0x4200000000000000000000000000000000000006` |
| polygon | WPOL | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` |
| arbitrum | WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |

## If `verify:hash` fails

The Pair bytecode in `../../uniswap-v2-core/build` no longer hashes to the value
in `contracts/libraries/UniswapV2Library.sol`. Copy the `computed` hash the
command prints into the `// init code hash` literal in that file, then
`yarn compile` the periphery repo again and redeploy — this invalidates every
network's deployment (the hash is chain-independent), so redeploy each one.
Compiler settings that affect the hash (must be identical between the hash
computation and the deployed Factory): solc `0.5.16`, `optimizer.runs = 999999`,
`evmVersion = istanbul` (see `../../uniswap-v2-core/.waffle.json`).

## Source verification

Use standard-JSON input with the settings above (core: solc 0.5.16; periphery:
solc 0.6.6; both optimizer on, runs 999999, evmVersion istanbul) on the
relevant explorer (KaiaScan / BscScan / Basescan / Polygonscan / Arbiscan — all
Etherscan-family, same "Verify & Publish" flow). Constructor args:
Factory = `feeToSetter`; Router02 = `(factory, WETH)`.
