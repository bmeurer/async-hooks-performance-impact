const cp = require('child_process');

const BENCHMARKS = [ 'bluebird-doxbee.js', 'bluebird-parallel.js', 'wikipedia.js' ];
const hook = './async-hook.js';

async function main() {
  for (benchmark of BENCHMARKS) {
    const regular = cp.spawnSync(process.execPath, [ benchmark ]);
    console.log(`regular ${regular.stdout.toString().trim()}`);
    const hooked = cp.spawnSync(process.execPath,
      [ '--require', './async-hook.js', benchmark ]);
    console.log(`hooked ${hooked.stdout.toString().trim()}`);
  }
}

main().catch(console.error);
