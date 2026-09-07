# Orbsie infrastructure

The owner authorized resource creation on 2026-09-07. The app runs on Vercel project `orbsie` under `grappeggias-projects`; the Google Cloud project is `orbsie`.

Google Cloud Storage has separate private Standard buckets `orbsie-assets-prod` and `orbsie-assets-dev` in `us-east1`. Uniform bucket access and public-access prevention are enabled. The `orbsie-vercel` workload identity pool/provider `vercel` trusts only this Vercel project's production and development identities. Each identity has object create/read permissions only on its own bucket. No Google service-account keys are created or stored in Vercel.

Cloud saves can archive committed, validated project JSON using content-addressed create-only object names. Archives are private and include project conversations; they are not public game artifacts. Database saving remains authoritative if the secondary archive is temporarily unavailable. Published games strip conversations and credentials.

Neon PostgreSQL provisioning uses the Free plan in `iad1`, with separate production and development resources. Provisioning initially paused at Vercel's required Neon terms-acceptance step; this document will be updated after connection and migrations are verified. Preview deployments do not receive production credentials.

Set `GCS_BUCKET` per environment and `GCP_WORKLOAD_IDENTITY_PROVIDER` to the full `//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` resource. Vercel supplies a short-lived OIDC token, exchanged through Google's documented Security Token Service. Local development uses `vercel env pull` to obtain a temporary development token; refresh it when expired.

References: [Vercel OIDC](https://vercel.com/docs/oidc/gcp), [Google federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation), [Cloud Storage pricing](https://cloud.google.com/storage/pricing), [Neon pricing](https://neon.com/pricing).
