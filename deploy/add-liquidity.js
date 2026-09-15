'use strict';
// Create a native-coin / ERC20 pool (or add to an existing one) via the Router,
// on any configured network (Kaia, BNB Chain, Base, Polygon, Arbitrum — see
// NETWORKS in lib.js).
//
//   router.addLiquidityETH(TOKEN, amountToken, minToken, minNative, to, deadline, {value: amountNative})
//
// For a brand-new pair this deploys the pair (CREATE2) and seeds it in ONE tx.
// The ratio AMOUNT_NATIVE : AMOUNT_TOKEN sets the pool's starting price — make it
// match the real market price or arbitrage bots will take the difference.
//
//   cd deploy && cp .env.example .env   # fill PRIVATE_KEY etc.
//   NETWORK=kaia TOKEN=0x... AMOUNT_NATIVE=1000 AMOUNT_TOKEN=150 npm run add-liquidity
//
// Amounts are in human units; token decimals are read on-chain (native coin = 18).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  JsonRpcProvider, Wallet, Contract, MaxUint256,
  isAddress, getAddress, parseUnits, formatUnits, formatEther,
} = require('ethers');
const { NETWORKS } = require('./lib');

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const ROUTER_ABI = [
  'function factory() view returns (address)',
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
];
const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
  'function token0() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

const req = (name) => {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`${name} is required (env or CLI: ${name}=...)`);
  return v;
};

async function main() {
  const netName = (process.env.NETWORK || '').trim();
  if (!netName) throw new Error(`set NETWORK (one of: ${Object.keys(NETWORKS).join(' | ')})`);
  const net = NETWORKS[netName];
  if (!net) throw new Error(`unknown NETWORK "${netName}" (expected: ${Object.keys(NETWORKS).join(' | ')})`);

  const pk = (process.env.PRIVATE_KEY || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('PRIVATE_KEY missing or malformed in .env');

  const tokenAddr = getAddress(req('TOKEN'));
  // AMOUNT_KAIA kept as a fallback alias for existing Kaia scripts/muscle memory.
  const amountNativeHuman = (process.env.AMOUNT_NATIVE || process.env.AMOUNT_KAIA || '').trim();
  if (!amountNativeHuman) throw new Error('AMOUNT_NATIVE is required (env or CLI: AMOUNT_NATIVE=...)');
  const amountTokenHuman = req('AMOUNT_TOKEN');
  const slippageBps = BigInt(process.env.SLIPPAGE_BPS || '100'); // 1%
  const rpc = (process.env.RPC_URL || '').trim() || net.rpc;

  const recFile = path.join(__dirname, `deployments.${netName}.json`);
  if (!fs.existsSync(recFile)) throw new Error(`no deployment record at ${recFile} — run \`npm run deploy\` first`);
  const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
  const routerAddr = getAddress(rec.UniswapV2Router02);

  const provider = new JsonRpcProvider(rpc, { chainId: net.chainId, name: netName }, { staticNetwork: true });
  const wallet = new Wallet(pk, provider);

  const router = new Contract(routerAddr, ROUTER_ABI, wallet);
  const factoryAddr = getAddress(await router.factory());
  const factory = new Contract(factoryAddr, FACTORY_ABI, provider);
  const wnative = getAddress(rec.WETH);
  const nativeSym = net.nativeSymbol || 'native coin';

  const token = new Contract(tokenAddr, ERC20_ABI, wallet);
  const [tSym, tDec] = await Promise.all([token.symbol().catch(() => 'TOKEN'), token.decimals()]);
  const tokenDecimals = Number(tDec);

  const amountNative = parseUnits(amountNativeHuman, 18);
  const amountToken = parseUnits(amountTokenHuman, tokenDecimals);
  const minNative = (amountNative * (10000n - slippageBps)) / 10000n;
  const minToken = (amountToken * (10000n - slippageBps)) / 10000n;

  const nativeBal = await provider.getBalance(wallet.address);
  const tokenBal = await token.balanceOf(wallet.address);
  const allowance = await token.allowance(wallet.address, routerAddr);

  const existingPair = await factory.getPair(wnative, tokenAddr);
  const pairExists = existingPair !== '0x0000000000000000000000000000000000000000';

  const feeData = await provider.getFeeData();
  const overrides = feeData.gasPrice ? { gasPrice: feeData.gasPrice } : {};

  const priceTokenPerNative = Number(amountTokenHuman) / Number(amountNativeHuman);

  console.log('────────────────────────────────────────────────────────');
  console.log(` network      : ${netName} (chainId ${net.chainId})`);
  console.log(` LP provider  : ${wallet.address}`);
  console.log(` router       : ${routerAddr}`);
  console.log(` factory      : ${factoryAddr}`);
  console.log(` pair         : ${wnative} (W${nativeSym})  +  ${tokenAddr} (${tSym}, ${tokenDecimals}d)`);
  console.log(` existing     : ${pairExists ? existingPair : 'none — will be created + seeded in this tx'}`);
  console.log(` add          : ${amountNativeHuman} ${nativeSym}  +  ${amountTokenHuman} ${tSym}`);
  console.log(` start price  : 1 ${nativeSym} = ${priceTokenPerNative} ${tSym}   (1 ${tSym} = ${(1 / priceTokenPerNative).toFixed(8)} ${nativeSym})`);
  console.log(` min (slip ${Number(slippageBps) / 100}%) : ${formatEther(minNative)} ${nativeSym} / ${formatUnits(minToken, tokenDecimals)} ${tSym}`);
  console.log(` balances     : ${formatEther(nativeBal)} ${nativeSym} / ${formatUnits(tokenBal, tokenDecimals)} ${tSym}`);
  console.log(` gasPrice     : ${overrides.gasPrice ? formatUnits(overrides.gasPrice, 'gwei') + ' gwei' : 'node default'}`);
  console.log('────────────────────────────────────────────────────────');

  if (!pairExists) {
    console.log('\n⚠  This ratio sets the pool\'s INITIAL PRICE. If it does not match the');
    console.log(`   real ${nativeSym}/${tSym} market price, arbitrage will immediately rebalance it`);
    console.log('   at your expense. Ctrl-C now if the price above looks wrong.\n');
  }
  if (tokenBal < amountToken) throw new Error(`insufficient ${tSym}: need ${amountTokenHuman}, have ${formatUnits(tokenBal, tokenDecimals)}`);
  if (nativeBal <= amountNative) throw new Error(`insufficient ${nativeSym}: need ${amountNativeHuman} + gas, have ${formatEther(nativeBal)}`);

  if (allowance < amountToken) {
    console.log(`approve ${tSym} -> router …`);
    const atx = await token.approve(routerAddr, MaxUint256, overrides);
    console.log(`  tx    : ${atx.hash}`);
    await atx.wait();
  }

  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  console.log('\naddLiquidityETH …');
  const tx = await router.addLiquidityETH(
    tokenAddr, amountToken, minToken, minNative, wallet.address, deadline,
    { value: amountNative, ...overrides },
  );
  console.log(`  tx    : ${tx.hash}`);
  const rcpt = await tx.wait();
  console.log(`  gas   : ${rcpt.gasUsed}`);

  // --- result ------------------------------------------------------------
  const pairAddr = getAddress(await factory.getPair(wnative, tokenAddr));
  const pair = new Contract(pairAddr, PAIR_ABI, provider);
  const [reserves, token0, lpTotal, lpBal] = await Promise.all([
    pair.getReserves(), pair.token0(), pair.totalSupply(), pair.balanceOf(wallet.address),
  ]);
  const wnativeIs0 = getAddress(token0) === wnative;
  const resNative = wnativeIs0 ? reserves[0] : reserves[1];
  const resToken = wnativeIs0 ? reserves[1] : reserves[0];

  console.log('\n════════════════════════════════════════════════════════');
  console.log(` pair         : ${pairAddr}`);
  console.log(` reserves     : ${formatEther(resNative)} ${nativeSym} / ${formatUnits(resToken, tokenDecimals)} ${tSym}`);
  console.log(` price        : 1 ${nativeSym} = ${(Number(formatUnits(resToken, tokenDecimals)) / Number(formatEther(resNative)))} ${tSym}`);
  console.log(` your LP      : ${formatEther(lpBal)}  (${(Number(lpBal * 10000n / lpTotal) / 100).toFixed(2)}% of pool)`);
  console.log(` explorer     : ${net.explorer}/address/${pairAddr}`);
  console.log('════════════════════════════════════════════════════════');

  const poolsFile = path.join(__dirname, `pools.${netName}.json`);
  const pools = fs.existsSync(poolsFile) ? JSON.parse(fs.readFileSync(poolsFile, 'utf8')) : [];
  pools.push({
    pair: pairAddr,
    tokenA: nativeSym, tokenB: tSym,
    tokenBAddress: tokenAddr, tokenBDecimals: tokenDecimals,
    seededNative: amountNativeHuman, seededToken: amountTokenHuman,
    tx: tx.hash, timestamp: new Date().toISOString(),
  });
  fs.writeFileSync(poolsFile, JSON.stringify(pools, null, 2) + '\n');
  console.log(` saved        : ${path.relative(process.cwd(), poolsFile)}`);
}

main().catch((e) => {
  console.error('\nADD-LIQUIDITY FAILED:', e.message || e);
  process.exit(1);
});
