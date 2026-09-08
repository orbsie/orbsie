import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  makePublicationManifest,
  PUBLICATION_MANIFEST_FILE,
  PUBLICATION_ARTIFACT_PATHS,
  PUBLICATION_USED_ASSETS_FILE,
  sha256,
  toVercelDeploymentFile,
  type PublicationFile,
} from "../src/lib/server/publication-artifact";
import { assetManifest } from "../src/lib/asset-catalog";

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  boundedJSON: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({
  requireUser: async () => ({ id: "owner" }),
  database: () => mock,
  checkOrigin: vi.fn(),
  boundedJSON: mock.boundedJSON,
  HttpError: class extends Error {},
  apiError: (e: Error) => Response.json({ error: e.message }, { status: 500 }),
}));
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
import { GET, POST } from "../src/app/api/publish/route";

const project = (id = "orb", revision = 2) =>
  JSON.stringify({ id, revision, title: "Test world" });

function artifactFiles(projectData = project()) {
  return [
    {
      file: "index.html",
      data: "<html><script src=runtime.js></script></html>",
    },
    { file: "project.json", data: projectData },
    { file: "runtime.js", data: "console.log('runtime');" },
    { file: "runtime.css", data: "body{margin:0}" },
    { file: "generated-geometry-worker.js", data: "self.onmessage=()=>{}" },
    { file: "asset-geometry-worker.js", data: "self.onmessage=()=>{}" },
  ] as const;
}

const catalogAsset = assetManifest.assets[0];
const catalogSource = assetManifest.sources.find(
  (source) => source.sourceId === catalogAsset.sourceId,
)!;
const catalogAssetFiles = (projectData = projectWithCatalogAsset()) =>
  [
    ...artifactFiles(projectData),
    {
      file: catalogAsset.path.slice(1),
      data: new Uint8Array(readFileSync(`public${catalogAsset.path}`)),
    },
    {
      file: catalogSource.license.textFile,
      data: new Uint8Array(readFileSync(catalogSource.license.textFile)),
    },
    {
      file: PUBLICATION_USED_ASSETS_FILE,
      data: JSON.stringify({
        schemaVersion: assetManifest.schemaVersion,
        catalogVersion: assetManifest.catalogVersion,
        assets: [catalogAsset],
        sources: [catalogSource],
      }),
    },
  ] as const;

function projectWithCatalogAsset() {
  return JSON.stringify({
    id: "orb",
    revision: 2,
    title: "Test world",
    entities: [
      {
        id: "tree",
        label: "Tree",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#ffffff",
        stage: "ready",
        geometry: {
          kind: "asset",
          assetId: catalogAsset.id,
          detail: "refined",
        },
      },
    ],
  });
}

function publicDeployment(
  files: readonly PublicationFile[] = artifactFiles(),
  overrides: { projectId?: string; revision?: number } = {},
) {
  const projectId = overrides.projectId ?? "orb";
  const revision = overrides.revision ?? 2;
  const artifact = makePublicationManifest(projectId, revision, files);
  const responses = new Map<string, Response>([
    [PUBLICATION_MANIFEST_FILE, new Response(artifact.data, { status: 200 })],
    ...files.map(
      ({ file, data }) =>
        [
          file,
          new Response(
            typeof data === "string"
              ? data
              : new Blob([data as unknown as BlobPart]),
            { status: 200 },
          ),
        ] as const,
    ),
  ]);
  return { artifact, responses };
}

function installFetch(
  deployment: ReturnType<typeof publicDeployment>,
  metadata: Record<string, unknown> = {},
) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push([url, init]);
      if (url.startsWith("https://api.vercel.com"))
        return Response.json({
          readyState: "READY",
          url: "orb.vercel.app",
          meta: {
            orbId: "orb",
            orbRevision: "2",
            artifactDigest: deployment.artifact.digest,
            ...metadata,
          },
        });
      const path = new URL(url).pathname.slice(1);
      return (
        deployment.responses.get(path) ??
        new Response("missing", { status: 404 })
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    deployment_id: "d2",
    public_url: "https://old.example",
    publication_revision: 2,
    published_revision: 1,
    ...overrides,
  };
}

async function get() {
  return GET(new Request("https://orbsie.test/api/publish?projectId=orb"));
}

beforeEach(() => {
  mock.query.mockReset();
  mock.connect.mockReset();
  mock.boundedJSON.mockReset();
  process.env.VERCEL_DEPLOY_TOKEN = "test";
  process.env.VERCEL_TEAM_ID = "test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("verifies every immutable artifact before atomically labeling the confirmed URL", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  mock.query.mockResolvedValueOnce({ rows: [{ published_revision: 2 }] });
  const deployment = publicDeployment();
  const { calls } = installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "READY",
    servedRevision: 2,
    deploymentUrl: "https://orb.vercel.app",
  });
  expect(mock.query.mock.calls[1][0]).toContain(
    "public_url=$1,published_revision=publication_revision",
  );
  expect(mock.query.mock.calls[1][1]).toEqual([
    "https://orb.vercel.app",
    null,
    "orb",
    "owner",
    "d2",
    2,
  ]);
  expect(calls.slice(1).every(([, init]) => !init?.headers)).toBe(true);
  expect(calls.slice(1).map(([url]) => new URL(url).pathname)).toEqual(
    expect.arrayContaining([
      "/publication-manifest.json",
      ...PUBLICATION_ARTIFACT_PATHS.map((file) => `/${file}`),
    ]),
  );
});

it("promotes matching pending metadata with the verified public URL", async () => {
  const publicationMetadata = {
    title: "Immutable world",
    creator: "Orb maker",
    revision: 2,
  };
  mock.query.mockResolvedValueOnce({
    rows: [row({ publication_metadata: publicationMetadata })],
  });
  mock.query.mockResolvedValueOnce({
    rows: [{ published_revision: 2, published_metadata: publicationMetadata }],
  });
  installFetch(publicDeployment());

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "READY",
    servedRevision: 2,
  });
  expect(mock.query.mock.calls[1][1]).toEqual([
    "https://orb.vercel.app",
    JSON.stringify(publicationMetadata),
    "orb",
    "owner",
    "d2",
    2,
  ]);
  expect(mock.query.mock.calls[1][0]).toContain(
    "published_metadata=COALESCE($2::jsonb,published_metadata)",
  );
});

it("continues to verify historical four-file publication manifests", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  mock.query.mockResolvedValueOnce({ rows: [{ published_revision: 2 }] });
  const deployment = publicDeployment();
  const legacyData = JSON.stringify({
    version: 1,
    projectId: "orb",
    revision: 2,
    files: deployment.artifact.manifest.files.slice(0, 4),
  });
  deployment.responses.set(
    PUBLICATION_MANIFEST_FILE,
    new Response(legacyData, { status: 200 }),
  );
  deployment.artifact.digest = sha256(legacyData);
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "READY",
    servedRevision: 2,
  });
});

it("verifies referenced catalog GLBs, licenses, and provenance", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  mock.query.mockResolvedValueOnce({ rows: [{ published_revision: 2 }] });
  const deployment = publicDeployment(catalogAssetFiles());
  const { calls } = installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "READY",
    servedRevision: 2,
  });
  expect(calls.map(([url]) => new URL(url).pathname)).toEqual(
    expect.arrayContaining([
      `/${catalogAsset.path.slice(1)}`,
      `/${catalogSource.license.textFile}`,
      `/${PUBLICATION_USED_ASSETS_FILE}`,
    ]),
  );
});

it("rejects a catalog reference when the model is omitted from the deployment", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const files = catalogAssetFiles().filter(
    ({ file }) => file !== catalogAsset.path.slice(1),
  );
  installFetch(publicDeployment(files));

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    error: `The public deployment is missing catalog asset ${catalogAsset.id}.`,
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("rejects catalog model bytes that do not match the checked-in asset hash", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const files = catalogAssetFiles().map((file) =>
    file.file === catalogAsset.path.slice(1)
      ? { ...file, data: new Uint8Array([0, 1, 2, 3]) }
      : file,
  );
  installFetch(publicDeployment(files));

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    error: `The public deployment catalog asset ${catalogAsset.id} failed its catalog integrity check.`,
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("does not claim readiness when an in-flight status request loses the deployment compare-and-swap", async () => {
  const pendingMetadata = {
    title: "New release",
    creator: "Orb maker",
    revision: 2,
  };
  mock.query.mockResolvedValueOnce({
    rows: [
      row({ deployment_id: "old", publication_metadata: pendingMetadata }),
    ],
  });
  mock.query.mockResolvedValueOnce({ rows: [] });
  installFetch(publicDeployment());

  const response = await get();

  expect(await response.json()).toEqual({ state: "VERIFYING" });
  expect(mock.query.mock.calls[1][0]).toContain(
    "AND deployment_id=$5 AND publication_revision=$6",
  );
  expect(mock.query.mock.calls[1][1]).toEqual([
    "https://orb.vercel.app",
    JSON.stringify(pendingMetadata),
    "orb",
    "owner",
    "old",
    2,
  ]);
});

it("keeps the previous public release when an artifact is corrupt", async () => {
  mock.query.mockResolvedValueOnce({
    rows: [
      row({
        publication_metadata: {
          title: "Pending release",
          creator: "Orb maker",
          revision: 2,
        },
        published_metadata: {
          title: "Previous release",
          creator: "Orb maker",
          revision: 1,
        },
      }),
    ],
  });
  const deployment = publicDeployment();
  deployment.responses.set(
    "runtime.js",
    new Response("console.log('corrupt');", { status: 200 }),
  );
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    servedRevision: 1,
    deploymentUrl: "https://old.example",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("rejects a project snapshot for the wrong world or revision", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const deployment = publicDeployment(artifactFiles(project("other-orb", 2)));
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    error: "The public deployment contains a different world or revision.",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("rejects a deployment with missing public assets", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const deployment = publicDeployment();
  deployment.responses.delete("runtime.css");
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    error: "The public deployment did not serve runtime.css (HTTP 404).",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("reports Vercel deployment protection without replacing the previous release", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const deployment = publicDeployment();
  deployment.responses.set(
    PUBLICATION_MANIFEST_FILE,
    new Response("protected", { status: 401 }),
  );
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "PROTECTED",
    servedRevision: 1,
    deploymentUrl: "https://old.example",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("refuses to promote backward deployments that have no integrity metadata", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  installFetch(publicDeployment(), { artifactDigest: undefined });

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    servedRevision: 1,
    error:
      "This deployment is missing immutable integrity metadata. Publish this revision again to create a verifiable release.",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("rejects redirects from the trusted deployment host", async () => {
  mock.query.mockResolvedValueOnce({ rows: [row()] });
  const deployment = publicDeployment();
  deployment.responses.set(
    PUBLICATION_MANIFEST_FILE,
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.example" },
    }),
  );
  installFetch(deployment);

  const response = await get();

  expect(await response.json()).toMatchObject({
    state: "VERIFYING",
    error:
      "The public deployment redirected while verifying publication-manifest.json; redirects are not accepted.",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});

it("republishes a legacy READY deployment with a new integrity manifest", async () => {
  const client = { query: vi.fn(), release: vi.fn() };
  mock.connect.mockResolvedValue(client);
  mock.boundedJSON.mockResolvedValue({ projectId: "orb", revision: 2 });
  client.query
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      rows: [
        {
          id: "orb",
          revision: 2,
          snapshot: {
            version: 1,
            id: "orb",
            title: "Test world",
            seed: 1,
            revision: 2,
            entities: [
              {
                id: "tree",
                label: "Tree",
                position: [0, 0, 0],
                scale: [1, 1, 1],
                color: "#ffffff",
                stage: "ready",
                geometry: {
                  kind: "asset",
                  assetId: catalogAsset.id,
                  detail: "refined",
                },
              },
            ],
            environment: {
              sky: "#dceee9",
              ground: "#91b977",
              water: "#59bdbb",
            },
            messages: [],
          },
          deployment_id: "legacy",
          publication_revision: 2,
          published_revision: 1,
          vercel_project_id: "vp",
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ count: "0" }] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({});
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/v13/deployments/legacy"))
        return Response.json({
          readyState: "READY",
          url: "legacy.vercel.app",
          meta: { orbId: "orb", orbRevision: "2" },
        });
      if (url.includes("/v6/deployments?"))
        return Response.json({ deployments: [] });
      if (url.includes("/v13/deployments?"))
        return Response.json({
          id: "new-deployment",
          uid: "new-deployment",
          readyState: "BUILDING",
          url: "new.vercel.app",
        });
      throw new Error(`Unexpected Vercel call: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const response = await POST(
    new Request("https://orbsie.test/api/publish", {
      method: "POST",
      body: JSON.stringify({ projectId: "orb", revision: 2 }),
    }),
  );

  expect(await response.json()).toMatchObject({
    state: "BUILDING",
    deploymentId: "new-deployment",
  });
  const deploymentCall = calls.find(
    ({ url, init }) =>
      url.includes("/v13/deployments?") && init?.method === "POST",
  );
  expect(deploymentCall).toBeDefined();
  const body = JSON.parse(String(deploymentCall?.init?.body));
  expect(body.meta).toMatchObject({ orbId: "orb", orbRevision: "2" });
  expect(body.meta.artifactDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(body.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: PUBLICATION_MANIFEST_FILE }),
    ]),
  );
  const deployedModel = body.files.find(
    (file: { file?: string }) => file.file === catalogAsset.path.slice(1),
  );
  expect(deployedModel).toMatchObject({ encoding: "base64" });
  expect(Buffer.from(deployedModel.data, "base64")).toEqual(
    readFileSync(`public${catalogAsset.path}`),
  );
  expect(body.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: catalogSource.license.textFile }),
      expect.objectContaining({ file: PUBLICATION_USED_ASSETS_FILE }),
    ]),
  );
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE orbs SET vercel_project_id"),
    [
      "vp",
      "new-deployment",
      2,
      JSON.stringify({
        title: "Test world",
        creator: "Orbsie creator",
        revision: 2,
      }),
      "orb",
    ],
  );
});

it("rejects an oversized publication asset before producing a manifest", () => {
  const oversized = "x".repeat(2 * 1024 * 1024 + 1);
  expect(() =>
    makePublicationManifest("orb", 2, [
      { file: "index.html", data: "index" },
      { file: "project.json", data: project() },
      { file: "runtime.js", data: oversized },
      { file: "runtime.css", data: "style" },
      { file: "generated-geometry-worker.js", data: "self.onmessage=()=>{}" },
      { file: "asset-geometry-worker.js", data: "self.onmessage=()=>{}" },
    ]),
  ).toThrow("runtime.js is larger than the publication verification limit.");
});

it("rejects arbitrary publication paths", () => {
  expect(() =>
    makePublicationManifest("orb", 2, [
      ...artifactFiles(),
      { file: "../../secrets.txt", data: "nope" },
    ]),
  ).toThrow(
    "Publication files must contain the immutable runtime set and only known local catalog paths.",
  );
});

it("encodes binary catalog files for the Vercel deployment API", () => {
  const file = toVercelDeploymentFile({
    file: catalogAsset.path.slice(1),
    data: new Uint8Array([0, 255, 1, 254]),
  });

  expect(file).toEqual({
    file: catalogAsset.path.slice(1),
    data: Buffer.from([0, 255, 1, 254]).toString("base64"),
    encoding: "base64",
  });
});
