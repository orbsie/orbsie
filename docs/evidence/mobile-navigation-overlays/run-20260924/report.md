# Mobile navigation overlay evidence

Status: **passed**
Target: http://127.0.0.1:3019
Source commit: 03929eb274b59052d9080587e53127a71e9ae10c
Tested the production build with the current working-tree `src/app/globals.css`.
Provider calls: 0; deterministic fixture NDJSON was intercepted.

- **portrait-390x844**: {"controls":{"x":290,"y":180,"width":90,"height":206},"advisory":{"x":12,"y":136,"width":240,"height":52.8},"toast":{"x":12,"y":190,"width":240,"height":41},"chatSheet":{"x":10,"y":471.1,"width":370,"height":362.9},"heading":{"x":20,"y":80,"width":210,"height":46},"toolbar":{"x":230,"y":81,"width":143,"height":42},"graphicsDismiss":{"x":221,"y":145,"width":20,"height":20},"toastDismiss":{"x":221,"y":203,"width":15,"height":15}}; checks: {"allOverlaysInsideViewport":true,"noOverlayIntersection":true,"dismissButtonsVisibleAndContained":true,"rendererReady":true,"selectedFixtureStillSaved":true,"noUnexpectedRequestsOrBrowserErrors":true,"bothDismissButtonsWork":true}
- **short-portrait-390x640**: {"controls":{"x":58,"y":294.8,"width":274,"height":54},"advisory":{"x":12,"y":136,"width":240,"height":52.8},"toast":{"x":12,"y":190,"width":240,"height":41},"chatSheet":{"x":10,"y":354.8,"width":370,"height":275.2},"heading":{"x":20,"y":80,"width":210,"height":46},"toolbar":{"x":230,"y":81,"width":143,"height":42},"graphicsDismiss":{"x":221,"y":145,"width":20,"height":20},"toastDismiss":{"x":221,"y":203,"width":15,"height":15}}; checks: {"allOverlaysInsideViewport":true,"noOverlayIntersection":true,"dismissButtonsVisibleAndContained":true,"rendererReady":true,"selectedFixtureStillSaved":true,"noUnexpectedRequestsOrBrowserErrors":true,"bothDismissButtonsWork":true}
- **short-landscape-844x390**: {"controls":{"x":10,"y":96,"width":86,"height":202},"advisory":{"x":104,"y":96,"width":357,"height":38},"toast":{"x":475,"y":96,"width":357,"height":41},"chatSheet":{"x":220,"y":200,"width":524,"height":180},"heading":{"x":16,"y":52,"width":578,"height":44},"toolbar":{"x":638,"y":52,"width":190,"height":38},"graphicsDismiss":{"x":430,"y":105,"width":20,"height":20},"toastDismiss":{"x":801,"y":109,"width":15,"height":15}}; checks: {"allOverlaysInsideViewport":true,"noOverlayIntersection":true,"dismissButtonsVisibleAndContained":true,"rendererReady":true,"selectedFixtureStillSaved":true,"noUnexpectedRequestsOrBrowserErrors":true,"bothDismissButtonsWork":true}

This is Chromium mobile/touch viewport evidence using the Canvas2D compatibility path, not physical-device or native-GPU certification.
