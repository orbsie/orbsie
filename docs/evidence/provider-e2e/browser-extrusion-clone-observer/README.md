# Live output-reference failure diagnosis

One real Luna request under the unchanged 512-token cap. The cloned-stream observer captured INVALID_SCENE_UPDATE at operation2, paths geometry.job.recipe.nodes[0].id and geometry.job.recipe.output. These correspond to an unreachable node and invalid output reference in the recipe validator. No edit/export/fallback occurred. The corrected instructions and successful subsequent run are documented in ../browser-extrusion-output-contract/.
