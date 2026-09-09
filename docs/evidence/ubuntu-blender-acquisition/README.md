# Ubuntu Blender packaging inputs

Downloaded from Ubuntu's public archive on 2026-09-09 UTC: the Blender and blender-data packages at version `4.0.2+dfsg-1ubuntu8`, the matching original source archive, Debian patch archive and source descriptor. Each binary matched the SHA-256 and size in the local apt index; each source archive matched its HTTPS `.dsc` descriptor. Exact URLs, hashes and sizes are in `report.json`.

Inputs are cached at `/home/marcos/.cache/orbsie-runtime/noble-4.0.2`. Both binary packages were extracted into a new private staging directory without installing or changing host packages. The extracted Blender executable matches the installed executable's SHA-256. Package copyright files and bundled notices remain in the extracted tree; the source archives are retained alongside the binaries.

This removes the missing Blender package/source input for an Ubuntu-specific candidate. It does not establish a complete native-dependency source closure, a fresh verified repository-signature chain, a portable distribution, pruning, or clean-host compatibility. Existing official-tarball validation was not relaxed. No model calls or Blender execution were used for acquisition.

The earlier native-notice inventory remains useful evidence for the installed host (342 files / 289 package notices); it is not the final dependency/source manifest of this newly acquired candidate. The next implementation must lock the Ubuntu dependency set, avoid the host-specific CUDA/OpenCL resolution, preserve matching sources/notices, and prove the declared Ubuntu target independently.

## Repository trust verification

`signature-chain.json` now records a passed offline signature chain for these exact inputs. `gpgv` validates the Noble base `InRelease` using the installed Ubuntu archive keyring and the expected 2018 signing-key fingerprint. The verifier parses only the signed plaintext emitted by `gpgv`. Signed SHA-256 entries authenticate the full binary index and compressed source index; the matching version/architecture records then authenticate both binary packages, the source descriptor and its two source archives. This supersedes the initial signature-unverified acquisition status above, without broadening the package scope.

```sh
python3 scripts/verify-ubuntu-blender-inputs.py /home/marcos/.cache/orbsie-runtime/noble-4.0.2
```

The cache includes `InRelease`, `Packages`, and `Sources.xz`. The pinned base release is dated April 25, 2024; this is an authenticity check for that snapshot, not a claim about current security-update coverage. No network or system installation occurs in the verifier. Separate negative checks rejected modified signed metadata and a same-size modified binary; see `signature-regressions.json`. Native dependency/source closure and clean-host certification remain open.
