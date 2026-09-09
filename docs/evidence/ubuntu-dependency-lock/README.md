# Ubuntu Blender dependency lock

The retained `lock.json` was produced from the signed Noble base indexes by `scripts/lock-ubuntu-blender-runtime.py`, using system Python and apt_pkg 2.8.3. It selects 374 packages totaling 290,549,088 archive bytes, including exact Blender 4.0.2+dfsg-1ubuntu8, Python, NumPy, bubblewrap and util-linux. Each package records its version, architecture, source identity, archive path, size and SHA-256 from authenticated metadata.

APT ran with an empty installed-status database, private configuration directories and only the verified main/universe indexes. Recommendations and suggestions were disabled. All required roots remained selected after resolution, with zero broken dependencies. No network, host package installation or Blender execution occurred.

Astra reviewed the worker implementation, required host configuration exclusion and post-repair root checks, and replaced output publication with an atomic no-overwrite operation. The final focused suite passed five tests covering deterministic resolution, output preservation, modified signed metadata, missing indexes and hostile APT_CONFIG. This is dependency metadata evidence, not verification of all archive bytes, source archive acquisition, runtime assembly, optional dynamically loaded libraries, or clean-host execution.
