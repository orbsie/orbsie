# Local lathe scene capture

The synthetic authoring stream added three tapered blue lathe parts to a
procedural tree, then replaced an unrelated object with a catalog asset. The
revision-bound capture fixture passed in desktop WebGL and forced Canvas2D
software rendering. Blue fruit pixels remained visible before and after the
replacement; screenshots were inspected. This confirms that the new part type
reaches both live renderers without a provider call and survives an unrelated
incremental scene edit.

The WebGL capture shows the lower pointed tips. At the 512-pixel software
capture size, the blue forms are visible but still stylized; this fixture does
not establish that a live model will choose a convincing strawberry shape or
make the right attachments. The forced software fixture intentionally denies
WebGL, which produces the recorded context-init browser diagnostic. The
generation route is synthetic; its aborted requests are fixture artifacts.

See [report.json](report.json) and the captured PNGs. No live model calls or
external requests were made.
