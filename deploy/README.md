# Deploy fee-modified Uniswap V2 to Kaia

Deploys the **exact bytecode** from the `build/` artifacts of
`Uniswap-v2-core` and `Uniswap-v2-periphery` (fee changed 0.3% → 0.1%) — no
recompilation, so the Factory's CREATE2 pair addresses stay consistent with the
init code hash hardcoded in `contracts/libraries/UniswapV2Library.sol`.

## Prerequisites

```bash
# 1. build artifacts must exist in BOTH repos
cd ../../Uniswap-v2-core     && yarn && yarn compile
cd ../../Uniswap-v2-periphery && yarn && yarn compile

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

# B. deploy Factory + Router02 (+ optional WETH9) to NETWORK from .env
npm run deploy
#    -> writes deployments.<network>.json, prints explorer links

# C. live sanity check: creates tokens, adds liquidity, swaps,
#    asserts the CREATE2 pair resolves and the 0.1% fee is in effect
npm run smoke
```

## .env

| var | meaning |
|---|---|
| `NETWORK` | `kairos` (testnet, 1001) or `mainnet` (8217) |
| `PRIVATE_KEY` | deployer EOA, 0x + 64 hex, funded with KAIA |
| `FEE_TO_SETTER` | can call `factory.setFeeTo`; blank = deployer |
| `WETH_ADDRESS` | blank = canonical WKAIA for the network; `deploy` = deploy bundled `WETH9`; `0x…` = explicit |
| `RPC_URL` | optional override of the public endpoint |

Canonical WKAIA used when `WETH_ADDRESS` is blank:

| network | WKAIA |
|---|---|
| kairos | `0x043c471bEe060e00A56CcD02c0Ca286808a5A436` |
| mainnet | `0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432` |

## If `verify:hash` fails

The Pair bytecode in `../../Uniswap-v2-core/build` no longer hashes to the value
in `contracts/libraries/UniswapV2Library.sol`. Copy the `computed` hash the
command prints into the `// init code hash` literal in that file, then
`yarn compile` the periphery repo again and redeploy. Compiler settings that
affect the hash (must be identical between the hash computation and the deployed
Factory): solc `0.5.16`, `optimizer.runs = 999999`, `evmVersion = istanbul`
(see `../../Uniswap-v2-core/.waffle.json`).

## Source verification on KaiaScan

Use standard-JSON input with the settings above (core: solc 0.5.16; periphery:
solc 0.6.6; both optimizer on, runs 999999, evmVersion istanbul). Constructor
args: Factory = `feeToSetter`; Router02 = `(factory, WETH)`.
