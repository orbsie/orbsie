# Immutable publication metadata

Publication captures the stored revision's title, a safe public creator display name, and an optional bounded PNG preview. The current editor captures a 320×180 preview synchronously from the mounted renderer. Pending metadata is stored with the deployment attempt and promoted alongside the verified URL under the existing deployment/revision compare-and-swap. Failed verification leaves the prior release intact. Public reads require matching metadata/release revisions and never fall back to draft titles or account emails.

Validation in this change: 23 targeted tests across publication-metadata, publication-regressions, and published-page passed; type checking passed. The actual shared-renderer browser fixture passed thumbnail PNG dimensions/size, no browser errors and zero provider calls; its preview is in `../formation-continuity/publication-thumbnail.png`.

These are local fixture and mocked-route checks, not a new live Vercel publication. Apply the additive `scripts/schema.sql` migration before deploying. Signed-out publication playback and responsive sharing-page visual review remain release gates. Legacy releases without metadata use a generic title/creator and have no preview until republished. Thumbnails supplied by a client are untrusted previews, not proof of artifact contents.
