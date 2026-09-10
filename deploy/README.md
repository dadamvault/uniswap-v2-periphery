# Deploy fee-modified Uniswap V2 to Kaia

Deploys the **exact bytecode** from the `build/` artifacts of
`uniswap-v2-core` and `uniswap-v2-periphery` (fee changed 0.3% → 0.1%) — no
recompilation, so the Factory's CREATE2 pair addresses stay consistent with the
init code hash hardcoded in `contracts/libraries/UniswapV2Library.sol`.

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

Get testnet KAIA for the deployer address: https://faucet.kaia.io

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

## Create a KAIA / ERC20 pool

`add-liquidity.js` calls `router.addLiquidityETH` — for a new pair it deploys the
pair (CREATE2) and seeds it in one tx. Amounts are human units; token decimals
are read on-chain. The `AMOUNT_KAIA : AMOUNT_TOKEN` ratio is the pool's starting
price, so match the real market rate.

```bash
# reads deployments.<NETWORK>.json for the Router; approves TOKEN; adds liquidity
NETWORK=mainnet \
TOKEN=0xd077a400968890eacc75cdc901f0356c943e4fdb \
AMOUNT_KAIA=1000 AMOUNT_TOKEN=150 \
npm run add-liquidity
```

| var | meaning |
|---|---|
| `TOKEN` | ERC20 to pair with native KAIA (e.g. USDT `0xd077…4fdb`, 6 decimals) |
| `AMOUNT_KAIA` / `AMOUNT_TOKEN` | human-unit amounts; their ratio = initial price |
| `SLIPPAGE_BPS` | min-amount tolerance, default `100` (1%); only bites on an existing pair |

Appends the result to `pools.<network>.json`. `PRIVATE_KEY` is the LP provider
and must hold the KAIA + token.

## .env

| var | meaning |
|---|---|
| `NETWORK` | `kairos` (testnet, 1001) or `mainnet` (8217) |
| `PRIVATE_KEY` | deployer EOA, 0x + 64 hex, funded with KAIA |
| `FEE_TO_SETTER` | can call `factory.setFeeTo` / `setFeeToSetter`; blank = deployer. Permanent control of the developer fee — use a secure key / multisig |
| `FEE_TO` | developer-fee recipient. When set, deploy calls `factory.setFeeTo(FEE_TO)`. Blank = fee stays OFF |
| `WETH_ADDRESS` | blank = canonical WKAIA for the network; `deploy` = deploy bundled `WETH9`; `0x…` = explicit |
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

Canonical WKAIA used when `WETH_ADDRESS` is blank:

| network | WKAIA |
|---|---|
| kairos | `0x043c471bEe060e00A56CcD02c0Ca286808a5A436` |
| mainnet | `0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432` |

## If `verify:hash` fails

The Pair bytecode in `../../uniswap-v2-core/build` no longer hashes to the value
in `contracts/libraries/UniswapV2Library.sol`. Copy the `computed` hash the
command prints into the `// init code hash` literal in that file, then
`yarn compile` the periphery repo again and redeploy. Compiler settings that
affect the hash (must be identical between the hash computation and the deployed
Factory): solc `0.5.16`, `optimizer.runs = 999999`, `evmVersion = istanbul`
(see `../../uniswap-v2-core/.waffle.json`).

## Source verification on KaiaScan

Use standard-JSON input with the settings above (core: solc 0.5.16; periphery:
solc 0.6.6; both optimizer on, runs 999999, evmVersion istanbul). Constructor
args: Factory = `feeToSetter`; Router02 = `(factory, WETH)`.
