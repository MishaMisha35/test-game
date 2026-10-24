import { mkdir, mkdtemp, cp, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'release');
const staging = await mkdtemp(join(tmpdir(), 'eternal-source-'));
const folder = join(staging, 'Eternal-Realms-Source');
const archive = join(output, `Eternal-Realms-${version}-Source.zip`);
// Explicit allowlist: no credentials, Git metadata, dependencies, or built binaries.
const entries = ['.gitignore', '.github', 'README.md', 'index.html', 'package.json',
  'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts',
  'playwright.config.ts', 'src', 'public', 'electron', 'scripts', 'tests', 'docs'];
await mkdir(output, { recursive: true });
await mkdir(folder);
try {
  for (const entry of entries) await cp(join(root, entry), join(folder, entry), {
    recursive: true,
    filter: async source => {
      const name = basename(source);
      if (['.git', 'node_modules', '.aws', '.ssh', '.codex'].includes(name) || name === '.env' || name.startsWith('.env.')) return false;
      if ((await lstat(source)).isSymbolicLink()) throw new Error('Source archive contains a symbolic link; review it before exporting.');
      return true;
    },
  });
  await rm(archive, { force: true });
  await new Promise((ok, fail) => {
    const child = spawn('zip', ['-q', '-r', archive, 'Eternal-Realms-Source'], { cwd: staging, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', code => code === 0 ? ok() : fail(new Error(`zip exited with ${code}`)));
  });
  const sums = [];
  for (const name of (await readdir(output)).sort()) {
    if (!name.endsWith('.zip') && !name.endsWith('.tar.gz')) continue;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(output, name))) hash.update(chunk);
    sums.push(`${hash.digest('hex')}  ${name}`);
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  console.log(`Source archive created: ${archive}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
