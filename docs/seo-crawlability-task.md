# Crawlability implementation contract

Queued after the current logging handoff. Owner requested better crawler discovery
and SEO. This does not authorize indexing previously unlisted shared worlds.

Root source review: layout metadata currently has only title, description and
icons; `/` renders Orbsie and existing landing copy; `/o/[id]` reads immutable
publication metadata but has no per-world metadata export. The database has no
separate public-discovery consent. Start with a homepage-only sitemap.

Use this repository's Next documentation before implementation:
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`
and `03-file-conventions/01-metadata/{robots,sitemap}.md` under that API-reference
directory. Route params are promises. Metadata files are cached by default.

One Luna task owns layout/home/share metadata, robots/sitemap, a minimal social
preview asset using existing brand artwork, and targeted acceptance fixtures.
Preserve the current renderer, creation controls and landing visual hierarchy.

- Set a fixed production metadata base, accurate title/description, Open Graph
  and Twitter sharing metadata. Put the homepage canonical on the homepage so
  shared worlds do not accidentally inherit `/` as their canonical.
- Preserve meaningful server-rendered homepage headings/copy and use real links
  for any added public navigation. Do not introduce hidden keyword copy, fake
  ratings, fake testimonials or claims of supported features that are not live.
- Add root robots and sitemap routes. Include only intentionally discoverable
  URLs; no enumeration of private accounts, drafts, API routes or shared-world IDs.
  Do not use a fabricated changing last-modified timestamp.
- Shared-world title/description must reflect validated immutable publication
  metadata and revision, never the owner's mutable draft. Reuse a bounded query
  helper to avoid divergent metadata/page reads. Preserve 404 behavior.
- Keep share pages noindex pending a distinct discovery choice. Crawlers must be
  allowed to fetch those pages to read noindex; robots exclusion is not a privacy
  mechanism. Keep account/provider callback URLs out of sitemap and metadata.
- Use an actual fetchable social-image URL. An inline data-URL thumbnail should
  not be blindly emitted as a crawler image URL.

Acceptance: targeted metadata/route tests and typecheck. Root verifies a production
build's returned HTML, crawler routes and relevant social-image response, then
checks deployed responses. Ensure the app's main `/` flow still works and the
new content does not overflow on phones. No model calls are needed. Search-engine
indexing and rankings are external outcomes, not acceptance claims.
