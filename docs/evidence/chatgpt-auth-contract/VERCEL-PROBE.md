# Vercel authentication host probe

Source baseline: `2fce0d5`. SDK: `@vercel/sandbox@3.2.2`.

The actual Vercel Sandbox run passed on September 9 UTC (September 8 local): one vCPU, nonpersistent filesystem, five-minute maximum lifetime. It installed the pinned Codex package, then denied outbound network access before starting the private authentication host. The protected HTTP status endpoint reported an idle, disconnected account; the same endpoint without a capability returned 401. The sandbox was deleted successfully after approximately 14 seconds. No login, inference, copied developer account, or persistent snapshot was used. This is hosted signed-out acceptance, not subscription authorization or generation acceptance.

To reproduce with the existing CLI login and linked project:

```sh
node scripts/build-chatgpt-host.mjs .vercel/chatgpt-host-build
ORBSIE_SANDBOX_PROBE=1 node scripts/verify-chatgpt-sandbox.mjs
```

The command creates a metered Vercel resource and deletes it in cleanup. It writes its report under `.vercel`; the checked-in result is `vercel-host-probe.json`. The report omits credentials and capability values. The recorded status URL no longer hosts a running service.

Next: authenticated Orbsie-to-host routing and owner mapping, allowed authentication egress for real consent, and lifecycle handling when the host expires. Model access and streamed generation still need implementation before the subscription workflow can be accepted end to end.
