// Dev launcher: bundles the small API/mock server once (fast start, no per-file transform),
// runs it with Node, and starts the Vite dev server. Restart to pick up server changes.
import { spawn, spawnSync } from 'node:child_process';
const bin = (name) => `node_modules/.bin/${name}`;
const built = spawnSync(bin('esbuild'), ['server/index.ts', '--bundle', '--platform=node', '--format=esm', '--packages=external', '--log-level=warning', '--outfile=dist-server/index.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const API_PORT = process.env.API_PORT ?? '8787';
const procs = [
  spawn('node', ['dist-server/index.mjs'], { stdio: 'inherit', env: { ...process.env, API_PORT } }),
  spawn(bin('vite'), [], { stdio: 'inherit', env: { ...process.env, API_PORT } }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
