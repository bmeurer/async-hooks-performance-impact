const cp = require('child_process');

const BENCHMARKS = [ 'bluebird-doxbee.js', 'bluebird-parallel.js', 'wikipedia.js', 'hapiserver.js', 'koaserver.js'];
const hook = './async-hook.js';

async function main() {
  for (benchmark of BENCHMARKS) {
    const regular = cp.spawnSync(process.execPath, [ benchmark ]);
    console.log(`regular ${regular.stdout.toString().trim()}`);
    const init = cp.spawnSync(process.execPath,
      [ '--require', './async-hook-init.js', benchmark ]);
    console.log(`init ${init.stdout.toString().trim()}`);
    const full = cp.spawnSync(process.execPath,
      [ '--require', './async-hook-full.js', benchmark ]);
    console.log(`full ${full.stdout.toString().trim()}`);
  }
}

main().catch(console.error);
