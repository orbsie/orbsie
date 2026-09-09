# Offline Ubuntu Blender dependency lock

Use the system /usr/bin/python3 interpreter, which provides `apt_pkg`, to
resolve the Ubuntu candidate from a signed local snapshot:

```sh
/usr/bin/python3 scripts/lock-ubuntu-blender-runtime.py \
  /home/marcos/.cache/orbsie-runtime/noble-4.0.2 \
  /tmp/orbsie-ubuntu-blender-dependency-lock.json
```

The input directory must contain the signed `InRelease` plus these exact
indexes:

| local file | signed Release path |
| --- | --- |
| `main-Packages` | `main/binary-amd64/Packages` |
| `Packages` | `universe/binary-amd64/Packages` |
| `main-Sources.xz` | `main/source/Sources.xz` |
| `Sources.xz` | `universe/source/Sources.xz` |

The tool checks the Noble archive signature with the Ubuntu archive keyring,
requires the expected archive fingerprint, and verifies each local index
against the signed Release SHA-256 and byte count. It does not run `apt
update`, access a repository, read the host dpkg status database, install
packages, or download package archives.

The resolver runs `apt_pkg` in a private temporary apt root with an empty
installed-status file, only the pinned main/universe amd64 package indexes,
`APT::Install-Recommends=false`, and `APT::Install-Suggests=false`. Its roots
are Blender `4.0.2+dfsg-1ubuntu8`, plus the snapshot candidates for
`python3-numpy`, `python3`, `bubblewrap`, and `util-linux`. The output is
deterministic JSON sorted by package identity. Every selected package includes
its exact version, architecture, component, source name/version/component,
signed-index `Filename`, byte count, and SHA-256.

This is a candidate dependency metadata lock. It does not download or verify
the package archives, assemble a runtime root, discover optional plugin
libraries, or certify a portable release. Corresponding source archives and
native closure assembly remain separate gates.

The verified candidate is retained at `docs/evidence/ubuntu-dependency-lock/lock.json`: 374 packages / 290,549,088 archive bytes. Host APT configuration is excluded before initialization, and output publication refuses concurrent destination creation. Five focused tests passed after Astra review.
