# Cloud recovery production release

Source `1ffc02e` deployed to https://orbsie.com, including snapshot preconditions and recovery race guards. Production build and TypeScript checks passed. The read-only public smoke verified root rendering, unauthorized journal rejection and exact runtime/worker hashes, with no browser errors or generation requests. The landing screenshot was visually reviewed.

Authenticated conflict/recovery evidence was gathered against the separate development database before deployment. This smoke does not claim new authenticated production or live-provider recovery coverage.
