# Orbsie infrastructure

The owner authorized resource creation on 2026-09-07. The app runs on Vercel project `orbsie` under `grappeggias-projects`; the Google Cloud project is `orbsie`.

Google Cloud Storage has separate private Standard buckets `orbsie-assets-prod` and `orbsie-assets-dev` in `us-east1`. Uniform bucket access and public-access prevention are enabled. The `orbsie-vercel` workload identity pool/provider `vercel` trusts only this Vercel project's production and development identities. Each identity has object create/read permissions only on its own bucket. No Google service-account keys are created or stored in Vercel.

Cloud saves can archive committed, validated project JSON using content-addressed create-only object names. Archives are private and include project conversations; they are not public game artifacts. Database saving remains authoritative if the secondary archive is temporarily unavailable. Published games strip conversations and credentials.

Neon PostgreSQL is provisioned on the Free plan in `iad1`: `orbsie-production` connects only to production, and `orbsie-development` only to development. Both migrations passed, including the additive `published_revision` column. Preview deployments do not receive production credentials.

Production/development authentication secrets, base URLs and storage variables are configured in Vercel. Production also has the team ID and five-Orb publishing quota. Creating a dedicated publication token through the API returned HTTP 403, “Cannot create tokens for this app.” The owner subsequently supplied a dedicated token. Its access to the Orbsie Vercel project was verified with HTTP 200, and it was stored as sensitive production `VERCEL_DEPLOY_TOKEN`. No personal CLI token was copied into the application. The supplied token cannot create projects: POST `/v11/projects` returns HTTP 403, “You don’t have permission to create the project.” Dedicated Orb publication remains blocked until its team permissions permit project and deployment creation.

Live development OIDC exchange, object upload and immutable retry passed. `scripts/verify-storage.ts` refuses buckets whose names do not end in `-dev`. A small verification object remains in the development bucket. Production acceptance passed real authentication, cloud save/list/reopen, cross-user isolation, stale-revision rejection, and private archive completion. See [cloud acceptance](cloud-verification.md).

Set `GCS_BUCKET` per environment and `GCP_WORKLOAD_IDENTITY_PROVIDER` to the full `//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` resource. Vercel supplies a short-lived OIDC token, exchanged through Google's documented Security Token Service. Local development uses `vercel env pull` to obtain a temporary development token; refresh it when expired.

References: [Vercel OIDC](https://vercel.com/docs/oidc/gcp), [Google federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation), [Cloud Storage pricing](https://cloud.google.com/storage/pricing), [Neon pricing](https://neon.com/pricing).

## Additional domain and private trial credential

`orbsie.app` and `www.orbsie.app` are attached to the existing `orbsie` project. Both verified HTTPS and return308 to `https://orbsie.com`, preserving paths and query strings. No second application or database was created for these aliases.

`AI_GATEWAY_API_KEY_FREE` is a sensitive production-only Vercel environment variable. The temporary local input file used to install it was deleted. The application uses it only in the server generation route; no public environment variable or client key delivery exists. See [trial policy](free-prompts.md).

Production and development trial/waitlist tables are migrated. Resend's Free native integration was selected for confirmation email, but installation is waiting for account-owner terms acceptance. No Resend key or verified sender exists yet; durable signups remain pending until those are configured.

A fresh production publication check on 2026-09-07 reused the existing synthetic cloud acceptance account and saved world. Reading the project returned HTTP 200; one `/api/publish` attempt returned HTTP 502 with the application's publishing-token permission error. No replacement credential was requested and no successful dedicated deployment is claimed. See [key recheck](evidence/resumed-delivery/publication-key-recheck.json).

## Generated model storage

Commit `094bfb8` adds authenticated `/api/generated-models` upload/read and the additive `generated_models` table. Apply `npm run db:migrate` to each target database before deploying this capability. The development migration has been applied; production migration and live generated-model cloud acceptance remain outstanding.

Generated GLBs use immutable private paths `generated/<owner SHA-256>/<content SHA-256>.glb`. Upload admission verifies byte length, content hash, supported geometry and actual scene bounds. A per-owner database lock reserves quota before storage: at most 256 models or 64 MiB, counting pending uploads. Failed writes remain pending and can be retried at the same identity. A successful immutable-object conflict is accepted only after reading and verifying the stored bytes.

Cloud world saving requires ready assets owned by the signed-in account. Opening a cloud world fetches and verifies its assets before replacing the current draft. Publication copies verified generated files and their manifest into the standalone artifact; private bucket URLs and account credentials are not included. This implementation does not establish successful dedicated Vercel publication, which still needs live verification after the existing token permission failure is resolved.
