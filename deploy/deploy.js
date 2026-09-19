'use strict';
// Deploy the fee-modified Uniswap V2 stack to any configured mainnet
// (Kaia, BNB Chain, Base, Polygon, Arbitrum — see NETWORKS in lib.js).
//
//   UniswapV2Factory(feeToSetter)          <- uniswap-v2-core/build
//   UniswapV2Router02(factory, WETH)       <- uniswap-v2-periphery/build
//   [optional] WETH9()                     <- uniswap-v2-periphery/build
//   [optional] factory.setFeeTo(FEE_TO)    <- developer fee, when FEE_TO is set
//
// Deploys the EXACT bytecode from the `build/` artifacts (no recompilation),
// so the Factory's CREATE2 pairs stay consistent with the init code hash
// hardcoded in UniswapV2Library.sol.
//
//   cp .env.example .env   # then edit
//   npm install
//   npm run deploy

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  JsonRpcProvider, ContractFactory, isAddress, getAddress,
  formatEther, formatUnits,
} = require('ethers');
const { NETWORKS, coreArtifact, peripheryArtifact, feeOverrides } = require('./lib');
const { assertMatch } = require('./verify-init-code-hash');
const { getWallet } = require('./wallet');

async function main() {
  // --- config ------------------------------------------------------------
  const netName = (process.env.NETWORK || '').trim();
  if (!netName) throw new Error(`set NETWORK in .env (one of: ${Object.keys(NETWORKS).join(' | ')}) — every one is a real mainnet, so this is never implied`);
  const net = NETWORKS[netName];
  if (!net) throw new Error(`unknown NETWORK "${netName}" (expected: ${Object.keys(NETWORKS).join(' | ')})`);

  const rpc = (process.env.RPC_URL || '').trim() || net.rpc;

  // --- safety: init code hash must match before we touch the network ----
  const initHash = assertMatch();

  // --- connect ---------------------------------------------------------------
  const provider = new JsonRpcProvider(rpc, { chainId: net.chainId, name: netName }, { staticNetwork: true });
  const wallet = await getWallet(provider); // encrypted keystore, password prompted

  const feeToSetter = (process.env.FEE_TO_SETTER || '').trim() || wallet.address;
  if (!isAddress(feeToSetter)) throw new Error(`FEE_TO_SETTER is not an address: ${feeToSetter}`);

  // developer fee — Uniswap V2 protocol fee switch (1/6 of the 0.1% swap fee)
  const feeTo = (process.env.FEE_TO || '').trim();
  if (feeTo && !isAddress(feeTo)) throw new Error(`FEE_TO is not an address: ${feeTo}`);

  // resolve WETH (the Router's constructor name for "wrapped native coin")
  const wethCfg = (process.env.WETH_ADDRESS || '').trim();
  let wethMode = 'canonical';
  let wethAddress = net.wnative;
  if (wethCfg.toLowerCase() === 'deploy') {
    wethMode = 'deploy';
    wethAddress = null;
  } else if (wethCfg) {
    if (!isAddress(wethCfg)) throw new Error(`WETH_ADDRESS is not an address: ${wethCfg}`);
    wethMode = 'explicit';
    wethAddress = getAddress(wethCfg);
  }

  const bal = await provider.getBalance(wallet.address);
  const shown = await feeOverrides(provider); // display only — each tx re-fetches its own

  console.log('────────────────────────────────────────────────────────');
  console.log(` network       : ${netName} (chainId ${net.chainId})`);
  console.log(` rpc           : ${rpc}`);
  console.log(` deployer      : ${wallet.address}`);
  console.log(` balance       : ${formatEther(bal)} ${net.nativeSymbol}`);
  const shownFee = shown.maxFeePerGas ?? shown.gasPrice;
  console.log(` gas fee cap   : ${shownFee ? formatUnits(shownFee, 'gwei') + ' gwei' + (shown.maxFeePerGas ? ' (max; base fee + tip is what is charged)' : '') : 'node default'}`);
  console.log(` feeToSetter   : ${feeToSetter}`);
  console.log(` feeTo (dev)   : ${feeTo ? getAddress(feeTo) : '(unset — protocol fee stays OFF)'}`);
  console.log(` WETH (wrapped native) : ${wethMode === 'deploy' ? '(deploy bundled WETH9)' : wethAddress + '  [' + wethMode + ']'}`);
  console.log(` initCodeHash  : 0x${initHash}  ✅ matches UniswapV2Library.sol`);
  console.log('────────────────────────────────────────────────────────');

  if (bal === 0n) {
    throw new Error(`deployer ${wallet.address} has 0 ${net.nativeSymbol} — fund it first`);
  }

  const deployed = async (label, artifact, args) => {
    const f = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const c = await f.deploy(...args, await feeOverrides(provider));
    const tx = c.deploymentTransaction();
    console.log(`\n${label}`);
    console.log(`  tx    : ${tx.hash}`);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`  addr  : ${addr}`);
    return { contract: c, address: addr };
  };

  // --- 1. WETH9 (optional) --------------------------------------------------
  if (wethMode === 'deploy') {
    const w = await deployed('WETH9', peripheryArtifact('WETH9'), []);
    wethAddress = w.address;
  }

  // --- 2. Factory --------------------------------------------------------
  const factory = await deployed('UniswapV2Factory', coreArtifact('UniswapV2Factory'), [feeToSetter]);

  // --- 3. Router02 -----------------------------------------------------------
  const router = await deployed('UniswapV2Router02', peripheryArtifact('UniswapV2Router02'), [factory.address, wethAddress]);

  // --- 4. sanity: on-chain factory reachable from router -------------------
  const routerFactory = await router.contract.factory();
  const routerWeth = await router.contract.WETH();
  const ok = getAddress(routerFactory) === getAddress(factory.address)
          && getAddress(routerWeth) === getAddress(wethAddress);
  console.log(`\nrouter.factory() -> ${routerFactory}`);
  console.log(`router.WETH()    -> ${routerWeth}`);
  console.log(ok ? 'wiring OK ✅' : 'wiring MISMATCH ❌');

  // --- 5. developer fee: turn on the protocol fee switch ------------------
  // Uniswap V2 `_mintFee` routes 1/6 of the 0.1% swap fee to `feeTo` as LP
  // tokens (carved from the LP share, not added on top). Only the feeToSetter
  // can flip it, so this only runs when the deployer IS the feeToSetter.
  let feeToStatus = feeTo ? 'requested' : 'unset';
  if (feeTo) {
    const onchainSetter = await factory.contract.feeToSetter();
    if (getAddress(onchainSetter) !== getAddress(wallet.address)) {
      feeToStatus = 'PENDING — call setFeeTo from the feeToSetter account';
      console.log(`\n⚠ FEE_TO is set but the deployer is not the feeToSetter (${onchainSetter}).`);
      console.log(`  From that account run: factory.setFeeTo(${getAddress(feeTo)})`);
    } else {
      console.log(`\nsetFeeTo — routing 1/6 of the 0.1% swap fee to ${getAddress(feeTo)}`);
      const tx = await factory.contract.setFeeTo(getAddress(feeTo), await feeOverrides(provider));
      console.log(`  tx    : ${tx.hash}`);
      const rcpt = await tx.wait();
      if (rcpt.status !== 1) throw new Error(`setFeeTo tx reverted: ${tx.hash}`);

      // Public RPCs (e.g. mainnet.base.org) load-balance across nodes, so the
      // read right after the receipt can hit a node that hasn't seen the block
      // yet and return the OLD value (a false MISMATCH — seen on Base). The tx
      // already succeeded, so poll a few times before calling it a mismatch.
      let onchainFeeTo = await factory.contract.feeTo();
      for (let i = 0; i < 10 && getAddress(onchainFeeTo) !== getAddress(feeTo); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        onchainFeeTo = await factory.contract.feeTo();
      }
      const feeOk = getAddress(onchainFeeTo) === getAddress(feeTo);
      feeToStatus = feeOk ? 'ON' : 'MISMATCH';
      console.log(`  factory.feeTo() -> ${onchainFeeTo}`);
      console.log(feeOk
        ? '  protocol fee ON ✅'
        : `  MISMATCH ❌ (tx succeeded in block ${rcpt.blockNumber} — re-check feeTo() on the explorer before assuming failure)`);
    }
  }

  // --- record ------------------------------------------------------------
  const record = {
    network: netName,
    chainId: net.chainId,
    deployer: wallet.address,
    feeToSetter,
    feeTo: feeTo ? getAddress(feeTo) : null,
    feeToStatus,
    WETH: wethAddress,
    wethMode,
    UniswapV2Factory: factory.address,
    UniswapV2Router02: router.address,
    initCodeHash: '0x' + initHash,
    rpc,
    timestamp: new Date().toISOString(),
  };
  const outFile = path.join(__dirname, `deployments.${netName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');

  console.log('\n════════════════════════════════════════════════════════');
  console.log(` saved   : ${path.relative(process.cwd(), outFile)}`);
  console.log(` Factory : ${net.explorer}/address/${factory.address}`);
  console.log(` Router  : ${net.explorer}/address/${router.address}`);
  console.log(` feeTo   : ${feeTo ? getAddress(feeTo) + '  [' + feeToStatus + ']' : 'OFF'}`);
  console.log('════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('\nDEPLOY FAILED:', e.message || e);
  process.exit(1);
});
