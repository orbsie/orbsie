# Offline agent Blender jobs

`scripts/run-blender-job.mjs` runs one bounded, typed modeling job through the
existing isolated Blender executor. It is local agent tooling. It does not
download software, call a model, accept Python, or provide a portable Blender
release.

The command requires an input JSON file and a destination directory that does
not already exist:

```sh
node scripts/run-blender-job.mjs /tmp/crystal-job.json /tmp/orbsie-model-output
```

Example `/tmp/crystal-job.json`:

```json
{
  "version": 1,
  "parts": [
    {
      "id": "crystal",
      "shape": "cone",
      "position": [0, 0.8, 0],
      "scale": [0.8, 1.6, 0.8],
      "color": "#8dd9ff",
      "segments": 16
    }
  ]
}
```

The typed data-only schema is `src/lib/modeling.ts`. It permits bounded
procedural primitives, mesh vertices/faces, extrusions, and lathes. The raw
input file is limited to 512 KiB. The existing executor performs schema
validation, resource isolation, runtime resolution, GLB validation, and
cancellation; this CLI does not duplicate that sandbox.

On success the new directory contains exactly:

```text
model.glb
metadata.json
```

`metadata.json` records the result schema/version, GLB SHA-256, canonical
bounds, materials, object statistics, and Blender version. It contains no
temporary work paths, input paths, secrets, or executable Python. A failed or
cancelled run removes only the output directory created by that invocation.

The executor resolves Blender using the existing `ORBSIE_BLENDER_RUNTIME_DIR`,
`ORBSIE_BLENDER_PATH`, and NumPy settings. The runtime must already be
installed and configured on the host. The disposable bundle contains the
trusted repository Python program and bundled TypeScript executor only; it does
not contain Blender, Node, a repository checkout, or a network client.

`--help` is available without a Blender runtime:

```sh
node scripts/run-blender-job.mjs --help
```

This is an offline component check and a convenient agent boundary. A real
installed-Blender run demonstrates local artifact production only; it does not
certify a portable release, clean-host compatibility, licensing/source
completeness, or a production modeling service.
