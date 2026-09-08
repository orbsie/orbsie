# Blender distribution inventory

Local file inventory reviewed on 2026-09-08 against the pinned official Blender 4.0.2 Linux archive and its runtime package. This records observed materials and gaps; it is not a distribution-completeness finding.

The package's `licenses/blender/license/` contains 15 release files, including GPL, Apache, BSD, MIT, Python, OpenSSL, font and jemalloc notices. `THIRD-PARTY-LICENSES.txt` contains 101 component headings. Additional notices remain inside the copied Python tree, `datafiles` and `scripts/addons/cycles/license`. The aggregate catalog has not been mapped to each shipped binary.

The packager now also requires and preserves the official archive's top-level `copyright.txt` and `readme.html` under `licenses/blender/`, with hashes in the license manifest and complete-tree integrity inventory. An actual copy from the extracted official archive matched byte-for-byte:

| File | SHA-256 |
| --- | --- |
| copyright.txt | `890bbe1c6281ee45405e41d9b7f0ff597543ef2cea126c5043d6881d12d5a9ab` |
| readme.html | `421a41452f9ede6dd237253f42f169bccb29a4e8ef5da387f1958d352aff818a` |

Remaining evidence needed before redistributing an installer:

- Exact corresponding Blender source, build configuration/instructions and dependency source materials for the shipped binaries. Current metadata contains URLs, not a source bundle or source-offer artifact. The archive's 267 Cycles source files are only a partial subset.
- Binary-to-license inventory for the bundled native dependency closure. The earlier manifest identifies 33 bundled and 29 host-provided direct native dependencies; host portability remains a separate gate.
- Nine missing per-distribution notices have now been acquired from the matching upstream PyPI source releases: Cython, autopep8, certifi, charset-normalizer, idna, pycodestyle, requests, toml and urllib3. `third_party/blender-python-notices/manifest.json` records verified archive and notice hashes. The packager now validates installed name/version metadata and notice hashes, then includes the notices and provenance under `licenses/python`. NumPy, pip, setuptools and zstandard license files were already present. This does not establish complete corresponding-source coverage.
- Node runtime distribution and its notices/source obligations if Node becomes part of the installer. The current application component requires host Node and includes Orbsie and Zod licenses.
- Trusted release artifact/manifest distribution, installation tests and supported-platform declarations. Local integrity metadata alone is not a signed source of trust.

The fresh notice-integrated runtime includes the release-notice correction and all 11 supplemental notices, matched against all nine bundled package names/versions. All notices are covered by the full-tree manifest and their individual hashes were independently verified. All 32 notice, packaging, integrity and real modeling tests passed; see `docs/evidence/packaged-companion/python-notices.json`. The package remains a nonportable prototype at 1,218,298,659 bytes.

Source acquisition check: the official `https://download.blender.org/source/` index returned HTTP 403 to a bounded direct request on 2026-09-08. No source archive was acquired through that request, and the endpoint was not retried. This leaves the corresponding-source gate open independently of the local notice work.
