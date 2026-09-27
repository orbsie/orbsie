# Cloud save after a local reload

The retained OpenRouter flagship world reached revision 42 locally while its
account copy remained at revision 35. After a browser reload, `refreshCloud()`
cleared the in-memory `cloudBaseline` because the two snapshots differed. The
ordinary Save action then sent a null base and received HTTP 409. The separate
acceptance replay succeeded only after a verified, direct compare-and-swap
continuation; that recovery path is not available to an ordinary user.

Implement a browser-facing recovery of the last acknowledged cloud base for
the active account and project. Keep `/api/projects` compare-and-swap as the
authority. A reload must not turn a valid local descendant into an apparent
new cloud project, nor may it silently overwrite a newer or unrelated account
snapshot.

Required behavior:

- Record the revision, snapshot token, and exact committed-scene identity of a
  successful cloud acknowledgement, scoped to the signed-in account and
  project. Do not persist provider credentials or raw prompts for this purpose.
- On reload, fetch the current cloud row and verify its revision and token
  before restoring that base. Also verify that the recovered local project is
  the acknowledged scene or a proven continuation of it (for example, through
  retained history or the generation journal). If proof is absent, keep the
  local draft and present a non-destructive conflict path.
- Preserve both scene changes and the account transcript. If local and cloud
  messages cannot be reconciled without loss or reordering, do not auto-save.
- Guard all asynchronous state updates against account and project switches.
  A 409 from a genuine competing save must remain a conflict, with the local
  draft retained.
- Once a verified base is restored, the ordinary Save control must send that
  base and receive the same server-side conflict protection as before. Publish
  still requires an acknowledged cloud revision.

Acceptance evidence should cover a signed-in generate → local edit → Undo →
reload → reopen local draft → Save journey; exact revision/content and message
preservation; a competing cloud update; account switch; and a draft with no
verified ancestor. Use synthetic browser/account fixtures for the change and
reserve another live model call only if those checks leave a specific gap.
