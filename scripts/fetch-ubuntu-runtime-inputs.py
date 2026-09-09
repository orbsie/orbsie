#!/usr/bin/env python3
"""Plan or acquire exact Ubuntu runtime binary and source inputs; never install."""
import argparse
import hashlib
import importlib.util
import json
import lzma
import os
from pathlib import Path
import time
import urllib.request

spec = importlib.util.spec_from_file_location('ubuntu_lock', Path(__file__).with_name('lock-ubuntu-blender-runtime.py'))
lock_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock_module)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError('Unexpected archive redirect')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('indexes', type=Path)
    parser.add_argument('lock', type=Path)
    parser.add_argument('cache', type=Path)
    parser.add_argument('--download', choices=['binaries', 'sources', 'all'])
    args = parser.parse_args()
    locked = json.loads(args.lock.read_text())
    verified = lock_module.build_lock(args.indexes.resolve(), Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg'))
    lock_module.require(locked == verified, 'Lock differs from authenticated offline resolution')
    records = {}
    for package in locked['packages']:
        records[package['filename']] = {'kind': 'binary', 'filename': package['filename'], 'size': package['size'], 'sha256': package['sha256']}
    required = {(p['source']['name'], p['source']['version']) for p in locked['packages']}
    found = set()
    for name in ['main-Sources.xz', 'Sources.xz']:
        with lzma.open(args.indexes / name, 'rt') as stream:
            for source in lock_module.parse_paragraphs(stream):
                identity = (source.get('Package'), source.get('Version'))
                if identity not in required:
                    continue
                found.add(identity)
                directory = lock_module.safe_package_filename(source['Directory'])
                for filename, (size, sha) in lock_module.parse_sha256_field(source['Checksums-Sha256'], 'source package').items():
                    lock_module.require(Path(filename).name == filename, 'Invalid source basename')
                    path = lock_module.safe_package_filename(directory + '/' + filename)
                    record = {'kind': 'source', 'filename': path, 'size': size, 'sha256': sha}
                    lock_module.require(path not in records or records[path] == record, 'Conflicting archive identity')
                    records[path] = record
    lock_module.require(found == required, 'Source closure is incomplete')
    files = sorted(records.values(), key=lambda item: (item['kind'], item['filename']))
    args.cache.mkdir(parents=True, exist_ok=True)
    manifest = {'schema': 'orbsie.ubuntu-runtime-acquisition/v1', 'lockSha256': lock_module.sha256_file(args.lock), 'sourcePackages': len(required), 'files': files, 'releaseCertified': False}
    plan = args.cache / 'acquisition-plan.json'
    if plan.exists():
        lock_module.require(json.loads(plan.read_text()) == manifest, 'Existing acquisition plan differs')
    else:
        with plan.open('x') as output:
            output.write(json.dumps(manifest, indent=2) + '\n')
    selected = [f for f in files if args.download == 'all' or f['kind'] == {'binaries': 'binary', 'sources': 'source'}.get(args.download)]
    print(json.dumps({'plannedFiles': len(files), 'sourcePackages': len(required), 'bytes': sum(f['size'] for f in files), 'selectedFiles': len(selected)}), flush=True)
    if not args.download:
        return
    report = {'status': 'running', 'verified': [], 'downloadMode': args.download, 'inferenceCalls': 0}
    last_request = 0.0
    opener = urllib.request.build_opener(NoRedirect())
    try:
        for record in selected:
            target = args.cache / record['filename']
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                lock_module.require(target.is_file() and target.stat().st_size == record['size'] and lock_module.sha256_file(target) == record['sha256'], 'Existing cached archive is invalid: ' + record['filename'])
            else:
                time.sleep(max(0, 2 - (time.monotonic() - last_request)))
                url = 'https://archive.ubuntu.com/ubuntu/' + record['filename']
                partial = target.with_name(target.name + '.partial')
                last_request = time.monotonic()
                owns_partial = False
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': 'Orbsie-runtime-packaging/1.0'})
                    with opener.open(request, timeout=60) as response, partial.open('xb') as output:
                        owns_partial = True
                        lock_module.require(response.url == url, 'Unexpected archive redirect')
                        size = 0
                        sha = hashlib.sha256()
                        while chunk := response.read(1024 * 1024):
                            size += len(chunk)
                            lock_module.require(size <= record['size'], 'Archive exceeds signed size')
                            sha.update(chunk)
                            output.write(chunk)
                    lock_module.require(size == record['size'] and sha.hexdigest() == record['sha256'], 'Downloaded archive integrity mismatch')
                    os.link(partial, target)
                finally:
                    if owns_partial:
                        partial.unlink(missing_ok=True)
            report['verified'].append(record['filename'])
            if len(report['verified']) % 25 == 0:
                print(json.dumps({'verified': len(report['verified']), 'total': len(selected)}), flush=True)
        report['status'] = 'passed'
    except BaseException as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        (args.cache / ('acquisition-' + args.download + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'verified': len(report['verified'])}), flush=True)


if __name__ == '__main__':
    main()
