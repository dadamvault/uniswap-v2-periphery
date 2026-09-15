'use strict';
// Create an encrypted JSON keystore so a deploy/add-liquidity/smoke run never
// needs a plaintext PRIVATE_KEY in .env (or anywhere else on disk).
//
//   npm run create-keystore              # generate a brand-new key (recommended)
//   npm run create-keystore -- --import  # encrypt a key you paste in
//
// --generate never displays or types the private key anywhere — it's created
// in memory and immediately encrypted to disk. That's the safest option for a
// NEW deployer/feeToSetter key. --import is for a key you already hold
// elsewhere; typing it at this terminal is still far better than putting it
// in a file, but treat that key as more exposed than a freshly generated one
// (terminal scrollback, clipboard managers, etc).
//
// The password is the only thing protecting the key at rest — there is no
// separate backup of the raw key. Forgetting the password means losing the
// key, by design (that's what "the key doesn't exist anywhere" requires).

const fs = require('fs');
const path = require('path');
const { Wallet } = require('ethers');
const { promptHidden } = require('./prompt');
const { KEYSTORE_PATH } = require('./wallet');

async function main() {
  if (fs.existsSync(KEYSTORE_PATH)) {
    throw new Error(`${KEYSTORE_PATH} already exists — remove it first if you want to replace it`);
  }

  const args = process.argv.slice(2);
  const doImport = args.includes('--import') || args.includes('-i');

  let wallet;
  if (doImport) {
    const pk = (await promptHidden('private key to import (0x...): ')).trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error('not a valid 0x + 64 hex private key');
    wallet = new Wallet(pk);
  } else {
    wallet = Wallet.createRandom();
    console.log('generated a new random key (never displayed, never touched disk unencrypted)');
  }
  console.log(`address: ${wallet.address}`);

  const pass1 = await promptHidden('new keystore password: ');
  if (pass1.length < 8) throw new Error('use a longer password (8+ chars) — it is the only protection on the key at rest');
  const pass2 = await promptHidden('confirm password: ');
  if (pass1 !== pass2) throw new Error('passwords did not match');

  process.stdout.write('encrypting (a few seconds, scrypt is intentionally slow)... ');
  const json = await wallet.encrypt(pass1);
  fs.writeFileSync(KEYSTORE_PATH, json);
  console.log('done');

  console.log(`\nwrote ${KEYSTORE_PATH} (gitignored — never commit it)`);
  console.log('\nNext:');
  console.log('  - leave PRIVATE_KEY blank in .env — deploy/add-liquidity/smoke now');
  console.log('    prompt for this password instead');
  if (doImport) {
    console.log('  - if that imported key lived in a file or .env anywhere, delete it there');
    console.log('    now; if you suspect it was ever exposed (backups, editor history, a');
    console.log('    screen share...), treat it as compromised and rotate away from it');
    console.log('    instead of trusting the keystore to fix that retroactively');
  }
  console.log(`  - fund/authorize this address as needed: ${wallet.address}`);
}

main().catch((e) => { console.error('\nFAILED:', e.message || e); process.exit(1); });
