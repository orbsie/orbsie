# Sharing-page responsive review

`node scripts/verify-published-layout.mjs` renders the actual sharing-page server component and stylesheet with synthetic database data and iframe content. Next Link is replaced with its anchor output for the isolated fixture. No database, publication, external font, or inference request is made. Browser fallback fonts are used.

Desktop (1280×800) and mobile (390×844) screenshots were inspected. The first mobile review found a wrapped creator name clipping the revision below the fixed header. Creator metadata now truncates to one line. Checks cover horizontal overflow, action/identity overlap, preview loading and vertical metadata bounds. Both sizes pass with a long title and creator name.

This proves the header layout with fixture content, not live public-game playback, production font metrics, or successful dedicated publication.
