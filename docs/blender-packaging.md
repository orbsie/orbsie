# Blender companion packaging feasibility

The repository now has a repeatable local packaging prototype at
`scripts/package-blender-runtime.mjs`. It packages an already installed Linux
Blender executable, its data directory, and the NumPy user site that this
machine's system Blender Python exporter needs. It also accepts a checksum
verified official Linux tarball and packages Blender's bundled libraries and
Python runtime. All outputs default to `/tmp`; they are deliberately outside
the repository and are not shipped application artifacts. This is not a
reproducible build: host libraries, filesystem metadata, timestamps, and
`ldd` results can vary between runs and machines.

Run it with:

```sh
node scripts/package-blender-runtime.mjs --replace
```

The verified official release route is:

```sh
node scripts/package-blender-runtime.mjs \
  --archive /tmp/orbsie-blender-source-mirror/blender-4.0.2-linux-x64.tar.xz \
  --checksum /tmp/orbsie-blender-source-mirror/blender-4.0.2.sha256 \
  --replace --output /tmp/orbsie-blender-runtime-official-4.0.2
```

The prototype produced on 2026-09-07/08 from this host was:

| Item                    | Evidence                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Blender                 | 4.0.2, Debian/Ubuntu package `4.0.2+dfsg-1ubuntu8`, `amd64`                                                              |
| Blender executable      | 79,148,504 bytes; SHA-256 `aab13f2e20400a7bc161813151acfe4586889aa964624f7a0bcfdfc066f9749d`                             |
| Blender resources       | 2,077 files, 65,206,806 bytes                                                                                            |
| NumPy                   | 2.5.0 package, 1,311 files, 40,454,367 bytes; native libraries add 28,266,427 bytes in 3 files                           |
| Prototype bundle        | 3,692 payload files, 218,415,841 bytes; 64,647-byte manifest; 218,480,488 total file bytes unpacked                      |
| Clean-environment probe | Blender Python and NumPy 2.5.0 imported; cold start 1,618 ms; a 3,272-byte GLB and 395,308-byte blend file were exported |

The checksum-verified official tarball prototype produced on the same host
was:

| Item                      | Evidence                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Official archive          | 277,588,768 compressed bytes; SHA-256 `5583a5588736da8858c522ef17fff5d73be59c47a6fe91ad29c6f3263e22086a` |
| Official archive payload  | 5,302 regular files, 1,315,515,076 bytes before packaging                                                |
| Blender executable        | 229,296,864 bytes; SHA-256 `6fe78c9e0a1cca51a598eb37c3288b975357efbe86dcee18d5e6fdecaaf1847e`            |
| Bundled Blender resources | 4,679 files, 714,671,225 bytes                                                                           |
| Bundled runtime libraries | 599 files, 370,243,657 bytes                                                                             |
| Official prototype bundle | 5,786 payload files, 1,697,147,078 bytes; 16,324-byte manifest; 1,697,163,402 total file bytes           |
| Clean-environment probe   | Bundled Blender Python and NumPy 1.23.5 imported; cold start 1,636 ms; the same 3,272-byte GLB exported  |

The script writes `manifest.json` with the executable version, source paths and
hash, package metadata, the complete `ldd` result, bundled license-file hashes,
unpacked byte counts, and the clean-environment probe result. The launcher
sets Blender's resource paths to the bundled `share/blender` tree and points
`PYTHONPATH` and `LD_LIBRARY_PATH` at the bundled Python/runtime files. The
system-package mode adds the NumPy user site; the official tarball uses its
bundled Python and NumPy. The probe starts
with an `env -i` equivalent: it supplies a temporary bundle-owned `HOME` and
`TMPDIR`, clears inherited Python paths and credentials, and runs from the
bundle directory. It does not mount the project tree or copy user files.

The official tarball is a working local modeling/export prototype and carries
Blender's bundled library closure, but it is still not a cross-host release.
Its executable links to the host's glibc, X11, and other platform libraries.
The system-package prototype additionally depends on the host's broad
multimedia/OpenGL closure, including OpenColorIO, OpenVDB, OpenImageIO,
OpenCV, and database libraries. The manifest records these paths. A clean
environment here means no inherited home, credentials, Python path, or project
working directory; it still uses the host's ABI and graphics-system closure.
The packager dereferences the archive's relative library and Python-extension
symlinks so the output remains usable after its temporary extraction directory
is removed; that is why the unpacked prototype is larger than the official
archive's compressed 277 MB payload.

No UI/data pruning was performed. Blender's runtime resolves resources across
its scripts and data tree, and this package gives no evidence that removing UI,
render-engine, font, or add-on files would preserve `bpy` modeling and GLB
export. Pruning belongs in a separately built and tested variant after each
removed path has a regression check. The browser continues to render the GLB;
the companion only constructs geometry and exports it.

The script accepts the pinned `blender-4.0.2-linux-x64.tar.xz` release and
requires its known SHA-256
(`5583a5588736da8858c522ef17fff5d73be59c47a6fe91ad29c6f3263e22086a`). An
arbitrary caller-supplied checksum is not treated as proof of an official
release. Replacement is limited to an explicitly disposable direct child of
the system temporary directory, and archive symlinks are copied only after
their canonical targets are proven to remain inside the extracted archive.

## Official source route

Blender's official Linux release is a portable tarball, and Blender's build
documentation says portable builds should be made on an older baseline; the
official release build environment is Rocky Linux 8. The pinned Blender 4.0.2
Linux x64 archive is listed at:

- Release index: <https://download.blender.org/release/Blender4.0/>
- Official mirror service: <https://mirror.blender.org/release/Blender4.0/>
- Mirror selected by the service in this environment: <https://mirror.fcix.net/blender/release/Blender4.0/>
- Archive: <https://download.blender.org/release/Blender4.0/blender-4.0.2-linux-x64.tar.xz>
- Checksum file: <https://download.blender.org/release/Blender4.0/blender-4.0.2.sha256>
- Linux build instructions: <https://developer.blender.org/docs/handbook/building_blender/linux/>
- Rocky Linux 8 release build notes: <https://developer.blender.org/docs/handbook/release_process/build/rocky_8/>

The release index reports the archive at 277,588,768 bytes. The canonical
`download.blender.org` endpoint returned HTTP 403 to the initial noninteractive
request, but Blender's own release page links its official mirror service. The
mirror redirected to the US `mirror.fcix.net` copy, and the downloaded archive
matched the authoritative checksum file before extraction. The script records the archive
name, byte count, checksum file, and hash in `manifest.json`. The archive's
bundled libraries still leave the host glibc and graphics ABI as release
requirements; a Rocky Linux 8 build remains the route for a controlled
redistributable baseline.

This evidence does not establish a complete corresponding-source closure for
the executable or its dependencies, nor an exact release build commit,
configuration, dependency-source bundle, or reproducible build recipe. The
official source repository and Rocky Linux 8 build notes are recorded as
starting points; release completeness remains unverified.

## Licensing and source notices

Blender is GPL-2.0-or-later, with third-party components carrying their own
notices. The system prototype copies the installed Blender copyright and
license files, including the third-party notices, and copies NumPy's
distribution metadata and license files. The official prototype copies the
release archive's `license/GPL-license.txt` and
`license/THIRD-PARTY-LICENSES.txt` tree. The manifest retains SHA-256 hashes
and source references for those notices. The host-provided dynamic libraries
are not part of the prototype's redistributable closure, so their licenses
must be collected before a portable runtime is published.

Authoritative references:

- Blender license: <https://www.blender.org/about/license/>
- Blender source: <https://projects.blender.org/blender/blender>
- Blender system requirements and portability note: <https://www.blender.org/download/requirements/>

### Bundled launcher component (2026-09-08)

The companion packager now accepts `OUTPUT_DIRECTORY --node-root NODE_DISTRIBUTION_DIRECTORY` and includes the pinned Linux x64 Node 22.22.0 executable and its complete license file. `orbsie-builder` launches without Node on PATH or a repository checkout. Only the executable and license are copied; global modules are excluded. Source and copied bytes must match the recorded hashes, and existing outputs are preserved.

Offline integration passed relocation into a path containing spaces, an empty PATH, cleared inherited Node options, repeated help startup, rejected empty runtime arguments, and failure without a Blender runtime. See [launcher evidence](evidence/packaged-node-launcher/report.json). The application plus Node occupies 124,801,022 bytes on the test host; the 89 ms measurement is help startup, not Blender cold start.

This remains a component, not the complete installer. Blender, native dependency closure, independent official Node archive provenance, clean-host installation and complete license/source delivery remain release gates. No new Blender construction or real-provider flow was exercised by this check.

### Offline distribution assembly (2026-09-08)

`node scripts/assemble-modeling-distribution.mjs OUTPUT --application-root APPLICATION --runtime-root RUNTIME` combines the explicit bundled-Node application package with an existing verified pinned Blender runtime. It performs no downloads or provider requests, rejects existing destinations and overlapping roots, checks source and copied runtime integrity, and records the complete copied tree in a candidate manifest. Application payloads are allowlisted; contained relative runtime symlinks are preserved. Partial output cleanup handles read-only directories without following symlinks.

The manifest explicitly keeps portability, native dependencies, complete licensing/corresponding source and clean-host certification open. The real-runtime assembly test is skipped when the official bundle is absent; synthetic tree and rejection tests do not prove a complete installer. The current workspace has no official runtime bundle, so this assembler has not yet produced a newly validated complete distribution here.
