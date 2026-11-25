import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const output = path.resolve('dist/backend');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  entryPoints: ['backend/src/index.ts'],
  outfile: path.join(output, 'index.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  packages: 'external',
  sourcemap: true
});

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
manifest.scripts = { start: 'node index.cjs' };
await writeFile(path.join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
await cp('package-lock.json', path.join(output, 'package-lock.json'));
await cp('public/puzzles', path.join(output, 'public/puzzles'), { recursive: true });
await cp('prisma/schema.prisma', path.join(output, 'prisma/schema.prisma'));

// npm ci v korenu predhodno napolni predpomnilnik. Paket ne potrebuje
// ponovne namestitve, prevajanja ali generiranja Prisma ob namestitvi na strežnik.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
  'ci', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'
], { cwd: output, stdio: 'inherit' });
await cp('node_modules/.prisma', path.join(output, 'node_modules/.prisma'), { recursive: true });

console.log(`Backend z odvisnostmi: ${output} (${process.platform}/${process.arch})`);
