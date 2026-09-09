# Ubuntu Blender packaging inputs

Downloaded from Ubuntu's public archive on 2026-09-09 UTC: the Blender and blender-data packages at version `4.0.2+dfsg-1ubuntu8`, the matching original source archive, Debian patch archive and source descriptor. Each binary matched the SHA-256 and size in the local apt index; each source archive matched its HTTPS `.dsc` descriptor. Exact URLs, hashes and sizes are in `report.json`.

Inputs are cached at `/home/marcos/.cache/orbsie-runtime/noble-4.0.2`. Both binary packages were extracted into a new private staging directory without installing or changing host packages. The extracted Blender executable matches the installed executable's SHA-256. Package copyright files and bundled notices remain in the extracted tree; the source archives are retained alongside the binaries.

This removes the missing Blender package/source input for an Ubuntu-specific candidate. It does not establish a complete native-dependency source closure, a fresh verified repository-signature chain, a portable distribution, pruning, or clean-host compatibility. Existing official-tarball validation was not relaxed. No model calls or Blender execution were used for acquisition.

The earlier native-notice inventory remains useful evidence for the installed host (342 files / 289 package notices); it is not the final dependency/source manifest of this newly acquired candidate. The next implementation must lock the Ubuntu dependency set, avoid the host-specific CUDA/OpenCL resolution, preserve matching sources/notices, and prove the declared Ubuntu target independently.
