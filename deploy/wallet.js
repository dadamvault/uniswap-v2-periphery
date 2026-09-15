'use strict';
// Resolve the signer these scripts operate as: an encrypted JSON keystore
// (default ./keystore.json, or KEYSTORE_PATH), unlocked with a password
// prompted at the terminal each run. No PRIVATE_KEY, no password, in any
// config file, ever, on purpose — nothing to accidentally commit or leave
// lying around on disk.
//
// Create a keystore with:  npm run create-keystore

const fs = require('fs');
const path = require('path');
const { Wallet } = require('ethers');
const { promptHidden } = require('./prompt');

const KEYSTORE_PATH = path.resolve(__dirname, process.env.KEYSTORE_PATH || 'keystore.json');

async function getWallet(provider) {
  if (!fs.existsSync(KEYSTORE_PATH)) {
    throw new Error(
      'no keystore found.\n' +
      `  Create one:  npm run create-keystore\n` +
      `  (looked for: ${KEYSTORE_PATH} — override with KEYSTORE_PATH)`,
    );
  }

  const json = fs.readFileSync(KEYSTORE_PATH, 'utf8');
  const password = await promptHidden(`keystore password (${path.basename(KEYSTORE_PATH)}): `);
  let wallet;
  try {
    wallet = await Wallet.fromEncryptedJson(json, password);
  } catch (e) {
    throw new Error(`could not unlock ${KEYSTORE_PATH}: ${e.message || e}`);
  }
  return wallet.connect(provider);
}

module.exports = { getWallet, KEYSTORE_PATH };
