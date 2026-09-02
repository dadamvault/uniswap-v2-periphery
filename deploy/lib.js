'use strict';
const fs = require('fs');
const path = require('path');

// Build-artifact directories produced by `yarn compile` (ethereum-waffle).
const CORE_BUILD = path.resolve(__dirname, '../../Uniswap-v2-core/build');
const PERI_BUILD = path.resolve(__dirname, '../build');
const LIBRARY_SOL = path.resolve(__dirname, '../contracts/libraries/UniswapV2Library.sol');

const NETWORKS = {
  kairos: {
    chainId: 1001,
    rpc: 'https://public-en-kairos.node.kaia.io',
    wkaia: '0x043c471bEe060e00A56CcD02c0Ca286808a5A436',
    explorer: 'https://kairos.kaiascan.io',
  },
  mainnet: {
    chainId: 8217,
    rpc: 'https://public-en.node.kaia.io',
    wkaia: '0x19Aac5f612f524B754CA7e7c41cbFa2E981A4432',
    explorer: 'https://kaiascan.io',
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

module.exports = {
  CORE_BUILD,
  PERI_BUILD,
  LIBRARY_SOL,
  NETWORKS,
  loadArtifact,
  coreArtifact,
  peripheryArtifact,
};
