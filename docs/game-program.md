# Composable gameplay implementation

The project format now accepts an optional `game` program. Programs contain bounded variables and ordered rules with triggers, conditions and actions. `set_game` replaces the entire program; `game: null` removes it. Existing worlds without this field retain their legacy behaviors.

Finish the geometry of every referenced object before installing rules. A referenced object cannot be removed or downgraded to coarse geometry: replace or clear its rules first. Refined geometry and material/transform edits preserve the program. Imported projects and committed checkpoints validate these dependencies too.

The pure engine supports start, click, collision, collection, input and timer events; variable and score conditions; variable updates, scoring, outcomes, reset, color, visibility, position and movement paths. Execution has explicit numeric, rule, action and timer catch-up bounds and executes no model-supplied code. Runtime state is separate from the saved program.

## Remaining delivery gates

- Connect one session to the player frame loop, with edge-triggered input/contact events and queued clicks.
- Apply the same position and visibility overrides to rendering and physics; keep editing responsive and preserve usable geometry while replacements load.
- Display program score, win and loss, and reset all runtime state coherently. Program outcomes must supersede legacy portal victory.
- Prove program persistence through local recovery, cloud checkpoints, exported source and independent browser playback.
- Run real provider-authored game flows with the authorized OpenRouter, Vercel AI Gateway and ChatGPT configurations. Unit tests and a successful build alone do not establish these workflows.

This document tracks an implementation in progress, not a completed gameplay release.
