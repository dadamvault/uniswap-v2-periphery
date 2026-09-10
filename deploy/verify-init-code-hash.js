'use strict';
// Recompute the UniswapV2Pair init code hash from the CURRENT core build and
// compare it to the value hardcoded in UniswapV2Library.sol.
//
// They MUST be equal, otherwise Router/Library `pairFor()` computes CREATE2
// addresses that do not match the pairs the Factory actually deploys, and every
// swap / addLiquidity call reverts.
//
// Run standalone:  node verify-init-code-hash.js
// Or import:       const { computeHash, libHash, assertMatch } = require('./verify-init-code-hash');

const fs = require('fs');
const { keccak256 } = require('ethers');
const { coreArtifact, LIBRARY_SOL } = require('./lib');

// keccak256 of the UniswapV2Pair creation bytecode (no 0x), lower-case hex.
function computeHash() {
  const { bytecode } = coreArtifact('UniswapV2Pair');
  return keccak256(bytecode).slice(2).toLowerCase();
}

// The 32-byte hex literal tagged `// init code hash` in UniswapV2Library.sol.
function libHash() {
  const src = fs.readFileSync(LIBRARY_SOL, 'utf8');
  const m = src.match(/hex'([0-9a-fA-F]{64})'\s*\/\/\s*init code hash/);
  return m ? m[1].toLowerCase() : null;
}

function assertMatch() {
  const computed = computeHash();
  const inLib = libHash();
  if (!inLib) {
    throw new Error(`could not locate the init code hash literal in ${LIBRARY_SOL}`);
  }
  if (computed !== inLib) {
    throw new Error(
      'init code hash MISMATCH\n' +
      `  computed from core build : ${computed}\n` +
      `  hardcoded in library     : ${inLib}\n\n` +
      'Fix: set the literal in contracts/libraries/UniswapV2Library.sol to\n' +
      `  hex'${computed}' // init code hash\n` +
      'then re-run `yarn compile` in uniswap-v2-periphery and redeploy.'
    );
  }
  return computed;
}

if (require.main === module) {
  const computed = computeHash();
  const inLib = libHash();
  console.log('computed (core build) :', computed);
  console.log('hardcoded (library)   :', inLib || '(not found)');
  try {
    assertMatch();
    console.log('\n✅ MATCH — pairFor() will resolve to real CREATE2 pair addresses');
  } catch (e) {
    console.error('\n❌ ' + e.message);
    process.exit(1);
  }
}

module.exports = { computeHash, libHash, assertMatch };
