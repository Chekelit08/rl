// Suite de bots (npm run test:bots): mecánicas aisladas + torneo rápido (jerarquía, estabilidad, rendimiento).
// El torneo completo es `node --experimental-strip-types tests/bots.tournament.ts`.
import { spawnSync } from 'node:child_process';

let failed = 0;
for (const [file, args] of [['tests/bots.mechanics.ts', []], ['tests/bots.tournament.ts', ['rapido']]] as [string, string[]][]) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', file, ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
