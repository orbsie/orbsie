# Ubuntu runtime acquisition plan

The plan maps the reviewed 374-package dependency lock to exact binary archives and matching source archives for all 267 source-package identities. It contains 1,224 files totaling 2,420,337,195 bytes. The source records and hashes come from the authenticated Noble main/universe Sources indexes. Planning re-runs the offline dependency resolver and requires the supplied lock to match exactly.

```sh
/usr/bin/python3 scripts/fetch-ubuntu-runtime-inputs.py \
  /home/marcos/.cache/orbsie-runtime/noble-4.0.2 \
  docs/evidence/ubuntu-dependency-lock/lock.json \
  /home/marcos/.cache/orbsie-runtime/noble-4.0.2-closure --download binaries
```

Without `--download`, this only writes or verifies the plan. Download modes are `binaries`, `sources`, and `all`. Each request is sequential and paced; redirects, HTTP errors, wrong sizes and hash mismatches stop acquisition without retry. Existing cached files must match their signed size/hash before reuse. Files are published without overwriting concurrent destinations, and only partial files created by that invocation are removed on failure. No host packages are installed and no model calls are made.

The modified-lock rejection check passed before cache creation or network startup. The retained plan is not evidence that all files have been acquired. Completion reports from the running acquisition are recorded separately; runtime assembly, source retention in the shipped bundle and clean-host validation remain open.
