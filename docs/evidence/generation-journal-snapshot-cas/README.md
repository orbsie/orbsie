# Generation recovery with snapshot preconditions

The local authenticated API/database run passed 17 checks across 34 requests: operation ordering and idempotency, checkpoint persistence, ownership isolation, append/cancel serialization, and revision/content drift rejection. The separate signed-in browser run opened the test cloud world and used Recover latest generation to restore its completed checkpoint. IndexedDB matched the run identity, revision and entities. The recovered tree screenshot was visually reviewed.

These checks used the actual development database and recovery UI, with no inference or production requests. They establish checkpoint recovery, not a new provider continuation or publication run.
