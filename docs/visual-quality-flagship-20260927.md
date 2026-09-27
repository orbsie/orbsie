# Flagship visual-quality review — September 27, 2026

The fresh OpenRouter Luna flagship game is mechanically playable, but the
generated mushroom misses the user's requested object and the response's own
description. The editor screenshot after the second call shows a pink cap
floating visibly above a pale stem. The standalone export retains the gap;
the cap is mostly outside the player camera. The portal is much larger than
the playable island and competes with the edited object for attention. This
world passes syntax, gameplay, export, and publication checks; those checks do
not establish visual quality.

The saved `tree-a` recipe makes the geometry gap reproducible without another
model call. Its stem cylinder is centered at local Y 1.15 with height 2.3, so
its top is Y 2.3. The cap lathe part is positioned at Y 2.85 and its first
profile height is 1.15, so its bottom is Y 4.0: a 1.7-meter separation. Its
three pale spot parts are centered around Y 4.03, at the bottom of that cap,
which also explains why the described visible spots are hard to see. These
are recipe coordinates in the retained private project artifact; this report
does not include its prompt, account state, or raw model output.

Next quality pass should add a compact, explicit part-coordinate example to
the generation contract: a lathe profile height is local to its part and
combines with the part's position and entity transform. For an attached cap,
calculate the stem top and cap bottom in the same coordinates, then place
surface details above the cap's visible shoulder. Prefer a general bounds or
image-based review check for required attachment and in-frame visibility over
a mushroom-specific repair rule. Keep intentionally floating objects valid.
Evaluate the result with a fresh, bounded Luna request only after synthetic
geometry/contract checks pass; inspect a stable editor frame and a player
camera frame, not just the model's descriptive commit message.
