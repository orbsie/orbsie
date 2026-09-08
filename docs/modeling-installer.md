# Modeling candidate installer

`node scripts/package-modeling-installer.mjs INPUT_DIRECTORY OUTPUT.run` packages one existing local modeling distribution as a Linux x64 self extracting installer. Both paths are explicit. The output must be a new `.run` file; the input must be a real directory containing a candidate `manifest.json`.

Before writing the installer, the packager verifies:

- `schema: orbsie.modeling-distribution/v1`, `status: candidate`, `candidate: true`, and `releaseCertified: false`;
- the complete `integrity.entries` and `integrity.treeSha256` from the assembler, excluding only the top level `manifest.json`;
- every file size, SHA-256, mode, directory and contained relative symlink, including rejection of dangling, escaping and cyclic links;
- that the input and output do not overlap through existing symlinked parents.

The verified candidate is copied to a private snapshot and checked again before `tar` creates the compressed payload. Archive option environment variables are cleared for that step. The installer embeds that payload and its SHA-256. Running the installer requires one explicit new destination directory on Linux x86_64. It canonicalizes the destination parent once, then checks `/bin/sh`, `tar`, `sha256sum`, `tail`, `awk`, `mktemp`, `mkdir`, `rm`, `cp`, `uname`, `find`, and `chmod` before creating temporary state. It rejects an existing destination, verifies the payload before extraction, rejects unsafe archive paths, extracts without restoring build-host ownership, preserves modes and internal symlinks, and uses a temporary staging tree with ownership limited to the directory created by that invocation. Failure cleanup makes only owned directory nodes writable without following symlinks before removing partial state. The bundled `orbsie-builder` launcher therefore continues to use the distribution's `node/bin/node` from paths containing spaces, without host Node, Python, a repository checkout or developer tools.

The installer reports the package as an Orbsie modeling candidate and preserves `releaseCertified=false`. The embedded SHA-256 detects payload corruption; it is not a publisher signature or authenticity proof. No download, provider call, release certification or publication occurs. The targeted tests use a synthetic candidate tree and a synthetic bundled executable; they do not certify the real Blender runtime, native dependency closure, licensing/source completeness, clean-host compatibility or a production release.

Example:

```sh
node scripts/package-modeling-installer.mjs \
  "/tmp/orbsie modeling candidate" \
  "/tmp/orbsie-modeling-candidate.run"

"/tmp/orbsie-modeling-candidate.run" "/opt/orbsie modeling"
```
