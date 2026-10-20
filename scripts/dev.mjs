// npm run dev: the library server and the Vite dev server together.
// Ctrl+C stops both. The web app proxies /api to the server.

import { spawn } from 'node:child_process';

const procs = [
  ['server', process.execPath, ['apps/server/src/server.js', '--port', '5174']],
  ['web', process.execPath, ['node_modules/vite/bin/vite.js', 'apps/web', '--host', '127.0.0.1', '--port', '5173', '--strictPort']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: 'inherit' });
  p.on('exit', (code) => { if (!stopping) { console.error(`The ${name} process stopped (code ${code}); stopping the other one.`); stop(code || 1); } });
  return p;
});
let stopping = false;
function stop(code = 0) { stopping = true; for (const p of procs) p.kill('SIGTERM'); setTimeout(() => process.exit(code), 300); }
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
