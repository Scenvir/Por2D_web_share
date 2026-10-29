'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {selectEncoding, isCompressible, compress} = require('./http-compression.cjs');
const digest = data => createHash('sha256').update(data).digest('base64url');
const fingerprint = stat => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');

// A shared byte/entry budget includes identity AND compressed representations.
// Oversized resources are served, but deliberately not retained. Stat is still
// checked per request; unchanged hot resources need no reads, hashes or zlib.
module.exports = function createResourceCache({root, manifestPath,
  maxBytes = 16*1024*1024, maxEntries = 256} = {}) {
  root = path.resolve(root || 'dist');
  manifestPath = manifestPath || path.join(root+'.assets','manifest.json');
  const cache = new Map(), pending = new Map();
  let bytes = 0;
  const counters = {hits:0, misses:0, reads:0, hashes:0, compressions:0, prebuiltHits:0};
  // Manifest is a deployment snapshot. Restart to use newly generated artifacts;
  // changed source files always fall back safely to runtime representations.
  let manifestPromise;
  function manifest() {
    return manifestPromise ||= fs.readFile(manifestPath,'utf8').then(JSON.parse)
      .then(value => value.version === 1 ? value.files : {}).catch(() => ({}));
  }
  function hash(data) { counters.hashes++; return digest(data); }
  function retain(key, value) {
    if (value.data.length > maxBytes || maxEntries <= 0) return;
    while (cache.size && (bytes+value.data.length > maxBytes || cache.size >= maxEntries)) {
      const oldest = cache.keys().next().value;
      bytes -= cache.get(oldest).data.length; cache.delete(oldest);
    }
    cache.set(key,value); bytes += value.data.length;
  }
  async function get(file, acceptEncoding) {
    file = path.resolve(file);
    const vary = isCompressible(path.extname(file));
    const encoding = selectEncoding(acceptEncoding,vary);
    if (!encoding) return {status:406,data:Buffer.alloc(0),vary};
    const stat = await fs.stat(file,{bigint:true});
    if (!stat.isFile()) throw Error('Not a regular resource');
    const stamp = fingerprint(stat), key = file+'\0'+stamp+'\0'+encoding;
    if (cache.has(key)) {
      counters.hits++;
      const value = cache.get(key); cache.delete(key); cache.set(key,value);
      return value;
    }
    if (pending.has(key)) return pending.get(key);
    counters.misses++;
    const operation = (async () => {
      counters.reads++;
      const source = await fs.readFile(file), sourceHash = hash(source);
      let data = source;
      if (encoding !== 'identity') {
        const relative = path.relative(root,file).split(path.sep).join('/');
        const entry = (await manifest())?.[relative];
        const artifact = entry?.sourceHash === sourceHash && entry?.[encoding];
        let prebuilt = false;
        // Only generated, basename-only artifacts from the manifest directory.
        if (artifact && /^[A-Za-z0-9_-]+\.(br|gz)$/.test(artifact.file)) {
          try {
            const candidate = await fs.readFile(path.join(path.dirname(manifestPath),artifact.file));
            if (hash(candidate) === artifact.hash) {
              data = candidate; prebuilt = true; counters.prebuiltHits++;
            }
          } catch (_) { /* Optional artifacts may be absent; runtime is authoritative. */ }
        }
        if (!prebuilt) { counters.compressions++; data = await compress(source,encoding); }
      }
      const value = {data,vary,etag:'"'+(encoding === 'identity' ? sourceHash : hash(data))+'"'};
      if (encoding !== 'identity') value.encoding = encoding;
      // Never retain bytes under a fingerprint that changed while reading.
      if (fingerprint(await fs.stat(file,{bigint:true})) === stamp) retain(key,value);
      return value;
    })();
    // Bound single-flight bookkeeping as well as retained payloads.
    if (pending.size < maxEntries) pending.set(key,operation);
    try { return await operation; } finally { if (pending.get(key) === operation) pending.delete(key); }
  }
  get.stats = () => ({...counters,bytes,entries:cache.size,pending:pending.size,maxBytes,maxEntries});
  return get;
};
module.exports.digest = digest;
