import { archiveProjectSnapshot } from "../src/lib/server/storage";
import { blankProject } from "../src/lib/protocol";

if (!process.env.GCS_BUCKET?.endsWith("-dev"))
  throw Error("Storage verification requires a development bucket.");
const project = blankProject();
project.title = "Storage verification";
const first = await archiveProjectSnapshot(
  "orbsie-storage-verification",
  project,
);
const retry = await archiveProjectSnapshot(
  "orbsie-storage-verification",
  project,
);
if (
  !first ||
  !retry ||
  first.object !== retry.object ||
  retry.generation !== "existing"
)
  throw Error("Immutable archive retry verification failed.");
console.log(
  JSON.stringify({
    bucket: process.env.GCS_BUCKET,
    object: first.object,
    immutableRetry: true,
  }),
);
