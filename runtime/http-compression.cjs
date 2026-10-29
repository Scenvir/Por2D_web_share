'use strict';
const {createHash} = require('node:crypto');
const {promisify} = require('node:util');
const zlib = require('node:zlib');
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const extensions = new Set(['.html','.js','.css','.json','.md','.txt','.svg','.wasm']);

function selectEncoding(header, compressible) {
  const weights = new Map();
  for (const item of (header || '').toLowerCase().split(',')) {
    const [name, ...parameters] = item.trim().split(';');
    if (!name) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = parameter.trim().match(/^q\s*=\s*(.*)$/);
      if (match) quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]) ? Number(match[1]) : 0;
    }
    weights.set(name.trim(), quality);
  }
  const quality = name => weights.get(name) ?? (name === 'identity'
    ? (weights.get('*') === 0 ? 0 : 1) : (weights.get('*') ?? 0));
  // Prefer compressed representations on equal quality; never override q=0.
  const choices = compressible ? ['br','gzip','identity'] : ['identity'];
  return choices.filter(name => quality(name) > 0)
    .sort((a,b) => quality(b)-quality(a))[0];
}

async function compress(data, encoding) {
  return encoding === 'br'
    ? brotli(data, {params:{[zlib.constants.BROTLI_PARAM_QUALITY]:5}})
    : gzip(data, {level:6});
}

module.exports = function createCompression() {
  const cache = new Map();
  const limit = 16 * 1024 * 1024;
  let bytes = 0;
  return async function representation(data, extension, acceptEncoding) {
    const compressible = extensions.has(extension.toLowerCase());
    const encoding = selectEncoding(acceptEncoding, compressible);
    if (!encoding) return {status:406, data:Buffer.alloc(0), vary:compressible};
    if (encoding === 'identity') return {data, vary:compressible};
    // Content hashes prevent stale responses even if a file keeps its timestamp.
    const key = encoding + ':' + createHash('sha256').update(data).digest('hex');
    let compressed = cache.get(key);
    if (!compressed) compressed = await compress(data, encoding);
    if (cache.has(key)) { bytes -= cache.get(key).length; cache.delete(key); }
    if (compressed.length <= limit) {
      while (bytes + compressed.length > limit || cache.size >= 256) {
        const oldest = cache.keys().next().value;
        bytes -= cache.get(oldest).length;
        cache.delete(oldest);
      }
      cache.set(key, compressed); bytes += compressed.length;
    }
    return {data:compressed, encoding, vary:true};
  };
};
module.exports.selectEncoding = selectEncoding;
module.exports.isCompressible = extension => extensions.has(extension.toLowerCase());
module.exports.compress = compress;
