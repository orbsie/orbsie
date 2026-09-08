# Gameplay support production release

Source `6cc96d3` deployed to https://orbsie.com with the support-loss and reflected-scale collision fixes. Production build/typecheck passed. The read-only production smoke passed root rendering, unauthorized journal rejection and exact runtime/geometry-worker hashes without browser errors or generation requests. The landing screenshot was visually reviewed.

Specific collision cases have engine/session regression coverage. General editor and downloaded-player browser regression evidence is in `../game-actions-support-release/`; this production smoke does not constitute a new live-provider workflow.
