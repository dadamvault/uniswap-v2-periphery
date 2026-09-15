'use strict';
// Masked terminal input (password-style: characters are not echoed, `*` shown instead).
// No dependency — just raw stdin handling. No env-var fallback, by design:
// this project keeps secrets out of every config file, so there is
// deliberately no way to feed this a value except typing it.

function promptHidden(label) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error(`no interactive terminal to prompt "${label}"`));
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    let input = '';

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk) => {
      const s = String(chunk);
      for (const ch of s) {
        switch (ch) {
          case '\n': case '\r':
            cleanup();
            process.stdout.write('\n');
            resolve(input);
            return;
          case '': // Ctrl-C
            cleanup();
            process.stdout.write('\n');
            reject(new Error('cancelled'));
            return;
          case '': case '\b': // backspace / DEL
            if (input.length) {
              input = input.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            input += ch;
            process.stdout.write('*');
        }
      }
    };
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}

module.exports = { promptHidden };
