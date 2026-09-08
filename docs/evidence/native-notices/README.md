# Installed Blender native notice inventory

The offline tool from `d58326f` scanned the explicitly selected trusted `/usr/bin/blender` on 2026-09-08. Its output maps 342 filesystem entries to 289 installed packages, including installed binary/source package versions and copyright-notice paths, sizes and SHA-256 hashes. No package owners, package metadata or notices were missing. `linux-vdso.so.1` has no filesystem path and remains explicit in the unresolved list.

The Blender package is `4.0.2+dfsg-1ubuntu8`. This is the installed Ubuntu runtime, not the absent official portable archive. `verification.json` records an independent reread of all 289 notices: all sizes and hashes matched. Six focused tests, syntax checking and TypeScript passed after Astra review. The scan made no downloads or provider calls and changed no installed files.

To create a new report (existing destinations are refused):

```sh
node scripts/inventory-native-notices.mjs --binary /usr/bin/blender --output /absolute/path/new-report.json
```

`ldd` is run only on the explicitly selected trusted executable. Do not use this command on untrusted downloaded programs. Listed dependencies are queried as paths and are not recursively executed. Package ownership is matched to exact paths, with merged-usr aliases considered.

The report is provenance evidence, not a redistributable runtime or a complete licensing/source assessment. It does not hash the native binary contents, inventory runtime-loaded plugins, copy notices into an installer, supply corresponding sources, establish ABI portability, or validate a clean host. Those requirements remain open. The official archive's bundled libraries need their own inventory when the archive is available.
