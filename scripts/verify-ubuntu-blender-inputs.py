#!/usr/bin/env python3
"""Verify the pinned Noble Blender input chain without network or installation."""
import argparse
import hashlib
import json
import lzma
from pathlib import Path
import subprocess

VERSION = '4.0.2+dfsg-1ubuntu8'
SIGNER = 'F6ECB3762474EDA9D21B7022871920D1991BC93C'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def fields(text):
    result = {}
    key = None
    for line in text.splitlines():
        if line.startswith((' ', '\t')) and key:
            result[key] += '\n' + line.strip()
        elif ':' in line:
            key, value = line.split(':', 1)
            result[key] = value.strip()
    return result


def blocks(stream):
    block = []
    for line in stream:
        if line.strip():
            block.append(line)
        elif block:
            yield fields(''.join(block))
            block = []
    if block:
        yield fields(''.join(block))


def verify_file(path, size, sha):
    require(path.stat().st_size == int(size), f'Size mismatch: {path.name}')
    require(digest(path) == sha, f'SHA-256 mismatch: {path.name}')
    return {'file': path.name, 'bytes': int(size), 'sha256': sha}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--keyring', type=Path, default=Path('/usr/share/keyrings/ubuntu-archive-keyring.gpg'))
    args = parser.parse_args()
    root = args.directory
    release = root / 'InRelease'
    check = subprocess.run(['gpgv', '--status-fd', '2', '--output', '-', '--keyring', str(args.keyring), str(release)], capture_output=True, text=True)
    require(check.returncode == 0, 'Ubuntu release signature verification failed')
    require(any(line.startswith('[GNUPG:] VALIDSIG ' + SIGNER + ' ') for line in check.stderr.splitlines()), 'Unexpected Ubuntu signing key')
    metadata = fields(check.stdout)
    require(metadata.get('Codename') == 'noble', 'Unexpected distribution')
    hashes = {}
    for line in metadata['SHA256'].splitlines():
        if line.strip():
            sha, size, name = line.split()
            hashes[name] = (size, sha)
    indexes = []
    for local, remote in [('Packages', 'universe/binary-amd64/Packages'), ('Sources.xz', 'universe/source/Sources.xz')]:
        indexes.append(verify_file(root / local, *hashes[remote]))
    records = []
    selected = []
    with (root / 'Packages').open() as stream:
        for entry in blocks(stream):
            if entry.get('Package') in ('blender', 'blender-data') and entry.get('Version') == VERSION:
                selected.append(entry)
    require(len(selected) == 2 and {x['Package'] for x in selected} == {'blender', 'blender-data'}, 'Pinned binary records missing or ambiguous')
    for entry in selected:
        require(entry['Architecture'] == ('amd64' if entry['Package'] == 'blender' else 'all'), 'Unexpected architecture')
        name = Path(entry['Filename']).name
        records.append(verify_file(root / name, entry['Size'], entry['SHA256']))
    with lzma.open(root / 'Sources.xz', 'rt') as stream:
        selected = [entry for entry in blocks(stream) if entry.get('Package') == 'blender' and entry.get('Version') == VERSION]
    require(len(selected) == 1, 'Pinned source record missing or ambiguous')
    for line in selected[0]['Checksums-Sha256'].splitlines():
        if not line.strip():
            continue
        sha, size, name = line.split()
        require(Path(name).name == name and name not in ('.', '..'), 'Invalid source filename')
        records.append(verify_file(root / name, size, sha))
    print(json.dumps({'status': 'passed', 'version': VERSION, 'signer': SIGNER, 'releaseSha256': digest(release), 'releaseDate': metadata.get('Date'), 'indexes': indexes, 'files': records, 'scope': 'Pinned Blender binary/data and matching source package only', 'nativeDependencyClosureVerified': False, 'cleanHostVerified': False}, indent=2))


if __name__ == '__main__':
    main()
