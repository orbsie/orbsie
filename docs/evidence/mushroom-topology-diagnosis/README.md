# Mushroom topology diagnosis

The adaptive mesh has a strong measured topology difference from the uniform
mesh: many more boundary edges and T-junctions, plus small positive-area
triangles. These measurements support reviewing nonconforming refinement, but
they do not by themselves establish that the rendered speckles are caused by
raster cracks. Geometry checks are performed after normalizing each mesh to
unit height and centered X/Z; the prior numeric report is preserved in
`first-run.json`.
