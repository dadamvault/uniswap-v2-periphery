'use strict';
// Post-deploy sanity check against a live deployment (any NETWORK):
//   1. deploy two 18-decimal test ERC20s
//   2. addLiquidity through the Router (this also creates the pair via CREATE2)
//   3. confirm the pair address the Router computed == the pair the Factory made
//      (proves the init code hash is correct on-chain)
//   4. swap and confirm the output matches the 0.1% fee formula (999/1000),
//      and differs from stock Uniswap's 0.3% (997/1000)
//
//   npm run smoke

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  JsonRpcProvider, Contract, ContractFactory, getAddress, parseUnits, formatUnits,
} = require('ethers');
const { NETWORKS, coreArtifact, peripheryArtifact, feeOverrides } = require('./lib');
const { getWallet } = require('./wallet');

// local mirror of UniswapV2Library.getAmountOut with a configurable fee bps kept
const getAmountOut = (amountIn, reserveIn, reserveOut, feeNum) => {
  const inWithFee = amountIn * feeNum;
  return (inWithFee * reserveOut) / (reserveIn * 1000n + inWithFee);
};

async function main() {
  const netName = (process.env.NETWORK || '').trim();
  if (!netName) throw new Error(`set NETWORK (one of: ${Object.keys(NETWORKS).join(' | ')}) — every network here is a real mainnet`);
  const net = NETWORKS[netName];
  if (!net) throw new Error(`unknown NETWORK "${netName}"`);

  const recFile = path.join(__dirname, `deployments.${netName}.json`);
  if (!fs.existsSync(recFile)) throw new Error(`no deployment record: ${recFile} — run \`npm run deploy\` first`);
  const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));

  const rpc = (process.env.RPC_URL || '').trim() || net.rpc;
  const provider = new JsonRpcProvider(rpc, { chainId: net.chainId, name: netName }, { staticNetwork: true });
  const wallet = await getWallet(provider); // encrypted keystore, password prompted
  const ov = () => feeOverrides(provider); // fresh per tx — see lib.js

  console.log(`network ${netName}  router ${rec.UniswapV2Router02}  deployer ${wallet.address}\n`);

  const erc20 = peripheryArtifact('ERC20');
  const routerAbi = peripheryArtifact('UniswapV2Router02').abi;
  const factoryAbi = coreArtifact('UniswapV2Factory').abi;
  const pairAbi = coreArtifact('UniswapV2Pair').abi;

  const router = new Contract(rec.UniswapV2Router02, routerAbi, wallet);
  const factory = new Contract(rec.UniswapV2Factory, factoryAbi, wallet);

  // 1. two test tokens, 1,000,000 each
  const supply = parseUnits('1000000', 18);
  const mk = async (tag) => {
    const c = await new ContractFactory(erc20.abi, erc20.bytecode, wallet).deploy(supply, await ov());
    await c.waitForDeployment();
    const a = await c.getAddress();
    console.log(`  token ${tag}: ${a}`);
    return new Contract(a, erc20.abi, wallet);
  };
  console.log('deploying test tokens...');
  const tA = await mk('A');
  const tB = await mk('B');

  // 2. addLiquidity 1000 / 1000
  const amtA = parseUnits('1000', 18);
  const amtB = parseUnits('1000', 18);
  await (await tA.approve(router.target, amtA, await ov())).wait();
  await (await tB.approve(router.target, amtB, await ov())).wait();
  const deadline = Math.floor(Date.now() / 1000) + 900;
  console.log('\naddLiquidity...');
  await (await router.addLiquidity(tA.target, tB.target, amtA, amtB, 0, 0, wallet.address, deadline, await ov())).wait();

  // 3. pair address check
  const pairAddr = await factory.getPair(tA.target, tB.target);
  console.log(`  factory.getPair : ${pairAddr}`);
  if (getAddress(pairAddr) === '0x0000000000000000000000000000000000000000') throw new Error('pair not created');
  const pair = new Contract(pairAddr, pairAbi, wallet);
  const [r0, r1] = await pair.getReserves();
  const token0 = await pair.token0();
  const [resIn, resOut] = getAddress(token0) === getAddress(tA.target) ? [r0, r1] : [r1, r0];
  console.log(`  reserves        : in=${formatUnits(resIn, 18)}  out=${formatUnits(resOut, 18)}`);

  // 4. swap 10 A -> B
  const amtIn = parseUnits('10', 18);
  const [, quoted] = await router.getAmountsOut(amtIn, [tA.target, tB.target]);
  const expect999 = getAmountOut(amtIn, resIn, resOut, 999n);
  const expect997 = getAmountOut(amtIn, resIn, resOut, 997n);

  console.log('\nswap 10 A -> B');
  console.log(`  router.getAmountsOut : ${formatUnits(quoted, 18)}`);
  console.log(`  local 0.1% (999)    : ${formatUnits(expect999, 18)}   <- expected`);
  console.log(`  stock 0.3% (997)    : ${formatUnits(expect997, 18)}`);

  if (quoted !== expect999) throw new Error(`quote != 0.1% formula (got ${quoted}, want ${expect999})`);
  if (quoted === expect997) throw new Error('quote equals the 0.3% formula — fee change did NOT take effect');

  const balBefore = await tB.balanceOf(wallet.address);
  await (await tA.approve(router.target, amtIn, await ov())).wait();
  await (await router.swapExactTokensForTokens(amtIn, 0, [tA.target, tB.target], wallet.address, Math.floor(Date.now() / 1000) + 900, await ov())).wait();
  const received = (await tB.balanceOf(wallet.address)) - balBefore;
  console.log(`  actually received   : ${formatUnits(received, 18)}`);
  if (received !== quoted) throw new Error(`received ${received} != quoted ${quoted}`);

  console.log('\n✅ smoke test passed — CREATE2 pair + 0.1% fee confirmed on-chain');
}

main().catch((e) => { console.error('\nSMOKE FAILED:', e.message || e); process.exit(1); });
