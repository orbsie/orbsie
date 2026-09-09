# Offline Ubuntu Blender payload assembly

`scripts/assemble-ubuntu-blender-runtime.py` assembles a candidate rootfs from
an authenticated dependency lock and already downloaded Debian archives. It is
a payload operation only: it does not access a repository, install packages,
run `dpkg`, execute maintainer scripts or triggers, run `update-alternatives`,
run `ldconfig`, or execute Blender or the packaged Python runtime.

Usage:

```sh
/usr/bin/python3 scripts/assemble-ubuntu-blender-runtime.py \
  docs/evidence/ubuntu-dependency-lock/lock.json \
  /home/marcos/.cache/orbsie-runtime/noble-4.0.2-closure \
  /tmp/orbsie-ubuntu-blender-rootfs
```

The cache must contain every lock `filename` below its `pool/` directory. The
assembler checks each archive's byte count and SHA-256, then checks Debian
control `Package`, `Version`, and `Architecture` before reading its data member.
It preflights all data paths before creating the output, rejects traversal,
special files, escaping links, and conflicting payload paths, and preserves
regular files, modes, directories, hardlinks, and in-root symlinks. Absolute
Debian symlink targets are rewritten to equivalent relative targets and each
rewrite is recorded in `manifest.json`. The complete `/usr/share/doc` payload,
including package copyright files, is retained.

The output directory is new and contains the rootfs directly. Its
`manifest.json` uses `orbsie.ubuntu-blender-runtime/v1`, records
`status: candidate`, `portable: false`, and `releaseCertified: false`, and
contains the lock digest, exact package records, generated merged-usr state,
absolute-link rewrites, and a complete tree integrity inventory excluding the
manifest itself. `/bin`, `/sbin`, `/lib`, and `/lib64` are made into links to the
corresponding `/usr` directories; an empty payload directory at one of those
paths may be replaced, while a non-empty conflicting directory fails closed.
Missing `/usr` target directories are recorded as generated state.

A newly created output is cleaned only when its private ownership marker is
still present and matches this invocation. Existing output directories are
never overwritten. The assembler is deliberately not a runnable-runtime gate:
loader cache setup, alternatives policy, identity/configuration files, clean
namespace execution, native-library probing, source completeness, and release
provenance remain subsequent tasks. This candidate manifest does not certify a
portable or clean-host Blender runtime.

Astra review: six focused offline tests passed. Full preflight of the 374 verified archives passed with 10,769 unique payload paths and 26 absolute-link rewrites. No rootfs was constructed or executed in that check. Native integration is deferred behind the browser-first SDK; this script remains an optional candidate tool.
