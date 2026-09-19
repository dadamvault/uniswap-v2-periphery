'use strict';
const fs = require('fs');
const path = require('path');

// Build-artifact directories produced by `yarn compile` (ethereum-waffle).
const CORE_BUILD = path.resolve(__dirname, '../../uniswap-v2-core/build');
const PERI_BUILD = path.resolve(__dirname, '../build');
const LIBRARY_SOL = path.resolve(__dirname, '../contracts/libraries/UniswapV2Library.sol');

// `wnative` = canonical wrapped-native-coin address on that chain (passed as the
// Router's WETH constructor arg). Verified on-chain (name/symbol/decimals) 2026-09-14.
// Mainnet only — no testnets.
const NETWORKS = {
  kaia: {
    chainId: 8217,
    rpc: 'https://public-en.node.kaia.io',
    wnative: '0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432',
    nativeSymbol: 'KAIA',
    explorer: 'https://kaiascan.io',
  },
  bnb: {
    chainId: 56,
    rpc: 'https://bsc-dataseed.binance.org',
    wnative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    nativeSymbol: 'BNB',
    explorer: 'https://bscscan.com',
  },
  base: {
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    wnative: '0x4200000000000000000000000000000000000006',
    nativeSymbol: 'ETH',
    explorer: 'https://basescan.org',
  },
  polygon: {
    chainId: 137,
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    wnative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    nativeSymbol: 'POL',
    explorer: 'https://polygonscan.com',
  },
  arbitrum: {
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    wnative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    nativeSymbol: 'ETH',
    explorer: 'https://arbiscan.io',
  },
};

// Load a waffle artifact and normalise the fields we need.
function loadArtifact(dir, name) {
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `artifact not found: ${file}\n` +
      `Run \`yarn compile\` in the corresponding repo first.`
    );
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = (j.evm && j.evm.bytecode && j.evm.bytecode.object) || j.bytecode;
  if (!raw) throw new Error(`no creation bytecode in ${file}`);
  return { abi: j.abi, bytecode: '0x' + String(raw).replace(/^0x/, '') };
}

const coreArtifact = (name) => loadArtifact(CORE_BUILD, name);
const peripheryArtifact = (name) => loadArtifact(PERI_BUILD, name);

// Fee overrides for ONE transaction — call it again for every tx, never cache.
//
// Don't pin eth_gasPrice as a cap: on chains with a moving base fee it can sit
// at/below the next block's base fee, and by the second tx it's stale (Arbitrum:
// "max fee per gas less than block base fee" on the Router deploy right after
// a successful Factory deploy). ethers' EIP-1559 values give headroom
// (maxFee = 2 x baseFee + tip); only baseFee + tip is actually charged, the
// rest is refunded. Chains without EIP-1559 data (BNB) fall back to a fresh
// legacy gasPrice.
async function feeOverrides(provider) {
  const fd = await provider.getFeeData();
  if (fd.maxFeePerGas != null && fd.maxPriorityFeePerGas != null) {
    return { maxFeePerGas: fd.maxFeePerGas, maxPriorityFeePerGas: fd.maxPriorityFeePerGas };
  }
  return fd.gasPrice ? { gasPrice: fd.gasPrice } : {};
}

module.exports = {
  CORE_BUILD,
  PERI_BUILD,
  LIBRARY_SOL,
  NETWORKS,
  feeOverrides,
  loadArtifact,
  coreArtifact,
  peripheryArtifact,
};
