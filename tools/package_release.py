"""Package the checked-in runtime without accessing the development repository."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'Por2D-Web-Coop-Share'
TOP = {'README.md', '统计访问.txt', 'START-HERE.txt', 'start-local.cmd',
       'start-lan.cmd', '如何双人联机.txt'}


def collect():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    names = sorted(n for n in tracked if n in TOP or n.startswith(('runtime/', 'developer/')))
    required = TOP | {'runtime/dist/por2.js', 'runtime/dist/por2.wasm', 'runtime/server.cjs',
                      'runtime/node_modules/ws/LICENSE', 'developer/agent_example.cjs',
                      'developer/SCRIPT_INTERFACE.md'}
    if required - set(names):
        raise ValueError(f'Missing tracked package files: {sorted(required - set(names))}')
    entries = {}
    for name in names:
        path = ROOT / name
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError(f'Unsafe package path: {name}')
        entries[name] = path.read_bytes()
    return entries


def encoded_manifest(entries):
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(entries.items())}
    return (json.dumps(hashes, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-manifest', action='store_true', help='Update SHA256.json after editing package files')
    args = parser.parse_args()
    entries = collect()
    manifest = encoded_manifest(entries)
    if args.refresh_manifest:
        (ROOT / 'SHA256.json').write_bytes(manifest)
        print('Updated SHA256.json; commit it with the package changes.')
        return
    if json.loads((ROOT / 'SHA256.json').read_bytes()) != json.loads(manifest):
        raise ValueError('Stale SHA256.json. Run python tools/package_release.py --refresh-manifest and commit it.')
    entries['SHA256.json'] = manifest
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    archive_path = output / f'{NAME}.zip'
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(f'{NAME}/{name}', date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise ValueError('ZIP integrity check failed')
        for name, data in entries.items():
            if archive.read(f'{NAME}/{name}') != data:
                raise ValueError(f'ZIP content mismatch: {name}')
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    (output / f'{NAME}.zip.sha256').write_bytes(f'{digest}  {NAME}.zip\n'.encode())
    print(f'Packaged and verified {len(entries)} files: {archive_path.name}')


if __name__ == '__main__':
    main()
