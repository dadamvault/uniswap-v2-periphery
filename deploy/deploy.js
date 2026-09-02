'use strict';
// Deploy the fee-modified Uniswap V2 stack to Kaia.
//
//   UniswapV2Factory(feeToSetter)          <- Uniswap-v2-core/build
//   UniswapV2Router02(factory, WETH)       <- Uniswap-v2-periphery/build
//   [optional] WETH9()                     <- Uniswap-v2-periphery/build
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
  JsonRpcProvider, Wallet, ContractFactory, isAddress, getAddress,
  formatEther, formatUnits,
} = require('ethers');
const { NETWORKS, coreArtifact, peripheryArtifact } = require('./lib');
const { assertMatch } = require('./verify-init-code-hash');

async function main() {
  // --- config ------------------------------------------------------------
  const netName = (process.env.NETWORK || 'kairos').trim();
  const net = NETWORKS[netName];
  if (!net) throw new Error(`unknown NETWORK "${netName}" (expected: ${Object.keys(NETWORKS).join(' | ')})`);

  const pk = (process.env.PRIVATE_KEY || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('PRIVATE_KEY missing or malformed in .env');

  const rpc = (process.env.RPC_URL || '').trim() || net.rpc;

  // --- safety: init code hash must match before we touch the network ----
  const initHash = assertMatch();

  // --- connect ---------------------------------------------------------------
  const provider = new JsonRpcProvider(rpc, { chainId: net.chainId, name: netName }, { staticNetwork: true });
  const wallet = new Wallet(pk, provider);

  const feeToSetter = (process.env.FEE_TO_SETTER || '').trim() || wallet.address;
  if (!isAddress(feeToSetter)) throw new Error(`FEE_TO_SETTER is not an address: ${feeToSetter}`);

  // resolve WETH
  const wethCfg = (process.env.WETH_ADDRESS || '').trim();
  let wethMode = 'canonical';
  let wethAddress = net.wkaia;
  if (wethCfg.toLowerCase() === 'deploy') {
    wethMode = 'deploy';
    wethAddress = null;
  } else if (wethCfg) {
    if (!isAddress(wethCfg)) throw new Error(`WETH_ADDRESS is not an address: ${wethCfg}`);
    wethMode = 'explicit';
    wethAddress = getAddress(wethCfg);
  }

  const bal = await provider.getBalance(wallet.address);
  const feeData = await provider.getFeeData();
  const overrides = feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {};

  console.log('────────────────────────────────────────────────────────');
  console.log(` network       : ${netName} (chainId ${net.chainId})`);
  console.log(` rpc           : ${rpc}`);
  console.log(` deployer      : ${wallet.address}`);
  console.log(` balance       : ${formatEther(bal)} KAIA`);
  console.log(` gasPrice      : ${overrides.gasPrice ? formatUnits(overrides.gasPrice, 'gwei') + ' gwei' : 'node default'}`);
  console.log(` feeToSetter   : ${feeToSetter}`);
  console.log(` WETH (WKAIA)  : ${wethMode === 'deploy' ? '(deploy bundled WETH9)' : wethAddress + '  [' + wethMode + ']'}`);
  console.log(` initCodeHash  : 0x${initHash}  ✅ matches UniswapV2Library.sol`);
  console.log('────────────────────────────────────────────────────────');

  if (bal === 0n) throw new Error(`deployer ${wallet.address} has 0 KAIA — fund it first (testnet: https://faucet.kaia.io)`);

  const deployed = async (label, artifact, args) => {
    const f = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const c = await f.deploy(...args, overrides);
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

  // --- record ------------------------------------------------------------
  const record = {
    network: netName,
    chainId: net.chainId,
    deployer: wallet.address,
    feeToSetter,
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
  console.log('════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('\nDEPLOY FAILED:', e.message || e);
  process.exit(1);
});
