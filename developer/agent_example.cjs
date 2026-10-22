'use strict';
// Run from an extracted share package or the source workspace. No npm install needed.
const fs = require('node:fs');
const path = require('node:path');
const runtime = fs.existsSync(path.join(__dirname, '../runtime/dist/por2.js'))
  ? path.join(__dirname, '../runtime/dist') : path.join(__dirname, '../dist');
const createPor2 = require(path.join(runtime, 'por2.js'));
const {Player} = require(path.join(runtime, 'replay/player.js'));

async function main() {
  const core = await createPor2();
  const read = pointer => core.UTF8ToString(pointer);
  const state = () => JSON.parse(read(core._web_state()));
  const check = result => {
    if (!result) throw Error(read(core._web_error()));
  };
  function withText(text, maxBytes, use) {
    if (text.includes('\0')) throw Error('NUL is not allowed');
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > maxBytes) throw Error('Input too large');
    const pointer = core._malloc(bytes.length + 1);
    if (!pointer) throw Error('Allocation failed');
    try {
      core.HEAPU8.set(bytes, pointer);
      core.HEAPU8[pointer + bytes.length] = 0;
      return use(pointer);
    } finally { core._free(pointer); }
  }

  const catalog = JSON.parse(read(core._web_catalog_json()));
  const entry = catalog.maps.find(m => m.chapter === 1 && m.section === 0 && m.players === 1);
  if (!entry) throw Error('No single-player campaign map');
  const map = read(core._web_catalog_map(entry.chapter, entry.section, entry.id));
  if (!map) throw Error(read(core._web_error()));
  check(core._web_load_catalog(entry.chapter, entry.section, entry.id, 0, 0));
  console.log('map', entry, JSON.parse(read(core._web_export_level_json())).name);
  console.log('initial', state());

  // A copied JS string survives later WASM calls. Keep the same map and mode.
  const snapshot = read(core._web_snapshot());
  for (let frame = 1; frame <= 10; frame++) {
    core._web_tick(2); // Right, once per logical frame; no real-time timer needed.
    const {x, y, vx, vy, ticks} = state();
    console.log('sample', {frame, ticks, x, y, vx, vy});
  }
  core._web_shot(0, 260, 389); // Queue one blue shot; placement may fail on this map.
  core._web_tick(0);           // Consume the shot and advance one frame.
  console.log('shot', state());
  withText(snapshot, 65536, p => check(core._web_restore_snapshot(p)));
  console.log('restored', state());

  // Separate demo: both actors advance together. Third argument 0 means no snapshot.
  check(core._web_load_catalog(2,0,0, 0, 0));
  core._web_coop_shot(1, 0, 260, 389);
  core._web_coop_tick(2, 0);
  console.log('coop', state());

  let text = 'version 3\nrules 1\nchapter 1\nsection 0\nlevel 0\nf 10 2 0\nf 1 0 0\n';
  if (process.argv[2]) {
    const file = path.resolve(process.argv[2]);
    if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('Replay exceeds 8 MiB');
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) throw Error('Replay contains NUL');
    text = bytes.toString('utf8');
  }
  const player = new Player(core);
  player.load(text); // Resets the scene; Player now owns advancement of this instance.
  while (!player.status().completed) player.step(1);
  const {frame, totalFrames, completed, cleared, state: finalState} = player.status();
  console.log('replay', {frame, totalFrames, completed, cleared, state: finalState});
  // The built-in demo only illustrates input syntax, not a solution.
  if (process.argv[2] && !cleared) process.exitCode = 2;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
