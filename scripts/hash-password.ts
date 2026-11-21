// Usage: npm run hash-password   (type the password; input is hidden on a TTY)
//    or: echo -n 'secret' | npm run hash-password
import { hash } from '@node-rs/argon2';

async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  process.stderr.write('Password (hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve) => {
    let pw = '';
    stdin.on('data', (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          resolve(pw);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') pw = pw.slice(0, -1);
        else pw += ch;
      }
    });
  });
}

const password = await readPassword();
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
// argon2id (library default) with OWASP-recommended cost parameters.
console.log(await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }));
