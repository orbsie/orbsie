import assert from "node:assert/strict";

export class PublicationAcceptanceError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "PublicationAcceptanceError";
    this.status = options.status;
    this.state = options.state;
  }
}

/**
 * The live publication harness is an external-write check. Keep the gate in
 * the script's call path so importing this module for deterministic tests can
 * never reach an account, cloud save, or deployment.
 */
export function assertLivePublicationOptIn(env = process.env) {
  if (env.ORBSIE_LIVE_E2E !== "1")
    throw new PublicationAcceptanceError(
      "Refusing live publication acceptance: set ORBSIE_LIVE_E2E=1 explicitly.",
    );
}

export function republishWorld(world) {
  const revised = structuredClone(world);
  revised.revision = 2;
  revised.title = "A tiny island to share — Sunset crystal garden";
  const crystal = revised.entities?.find(
    (entity) => entity.id === "crystal-accept",
  );
  if (!crystal)
    throw new PublicationAcceptanceError(
      "The publication fixture is missing crystal-accept for the revision-2 material change.",
    );
  crystal.color = "#ff8f6b";
  return revised;
}

function responseStatus(result) {
  if (typeof result?.status === "number") return result.status;
  if (typeof result?.response?.status === "number")
    return result.response.status;
  return 200;
}

function responseBody(result) {
  return result?.body && typeof result.body === "object" ? result.body : {};
}

function responseError(result) {
  const body = responseBody(result);
  return typeof body.error === "string" ? body.error.slice(0, 240) : undefined;
}

function responseState(result) {
  const state = responseBody(result).state;
  return typeof state === "string" ? state : undefined;
}

function responseIsOk(result) {
  if (typeof result?.ok === "boolean") return result.ok;
  return responseStatus(result) >= 200 && responseStatus(result) < 300;
}

function failResponse(label, result) {
  const status = responseStatus(result);
  const state = responseState(result);
  const error = responseError(result);
  const detail = error ? `: ${error}` : state ? `: ${state}` : "";
  throw new PublicationAcceptanceError(
    `${label} failed (HTTP ${status})${detail}`,
    { status, state },
  );
}

function requireResponse(label, result) {
  if (!responseIsOk(result)) failResponse(label, result);
  const state = responseState(result);
  const error = responseError(result);
  if (["PROTECTED", "ERROR", "CANCELED"].includes(state) || error)
    throw new PublicationAcceptanceError(
      `${label} failed${state ? ` (${state})` : ""}${error ? `: ${error}` : ""}`,
      { status: responseStatus(result), state },
    );
  return responseBody(result);
}

function cookieFromSignup(result) {
  if (typeof result?.cookies === "string" && result.cookies.length > 0)
    return result.cookies;
  const response = result?.response;
  const lines = response?.headers?.getSetCookie?.() ?? [];
  const cookie = lines.map((line) => line.split(";", 1)[0]).join("; ");
  if (cookie.length > 0) return cookie;
  throw new PublicationAcceptanceError(
    "sign-up did not return a session cookie.",
  );
}

function identity(body) {
  for (const key of ["vercelProjectId", "vercel_project_id"]) {
    if (typeof body?.[key] === "string" && body[key].length > 0)
      return body[key];
  }
  return undefined;
}

function compareProjectIdentity(postBody, getBody, label, required) {
  const postProjectId = identity(postBody);
  const getProjectId = identity(getBody);
  if (postProjectId && getProjectId)
    assert.equal(
      getProjectId,
      postProjectId,
      `${label} GET/POST Vercel project mapping`,
    );
  if (required && (!postProjectId || !getProjectId))
    throw new PublicationAcceptanceError(
      `${label} mapping could not be verified: both POST and GET must expose vercelProjectId.`,
    );
  return postProjectId ?? getProjectId;
}

function deploymentUrl(body, label) {
  const value = body?.deploymentUrl ?? body?.public_url ?? body?.publicUrl;
  if (typeof value !== "string" || value.length === 0)
    throw new PublicationAcceptanceError(
      `${label} did not return a public deployment URL.`,
    );
  return value.replace(/\/$/, "");
}

function projectSnapshotUrl(deployment) {
  return `${deployment.replace(/\/$/, "")}/project.json`;
}

function assertPublicStatus(result, label) {
  const status = responseStatus(result);
  if (status < 200 || status >= 300)
    throw new PublicationAcceptanceError(`${label} failed (HTTP ${status}).`, {
      status,
    });
  return status;
}

function parsePublicText(result, label) {
  assertPublicStatus(result, label);
  if (typeof result?.text === "string") return result.text;
  if (typeof result?.body === "string") return result.body;
  return "";
}

function responseEvidence(result) {
  const body = responseBody(result);
  const evidence = {
    status: responseStatus(result),
    ok: responseIsOk(result),
  };
  const fields = [
    ["state", body.state],
    ["error", responseError(result)],
    ["revision", body.revision],
    ["servedRevision", body.servedRevision],
    ["deploymentId", body.deploymentId],
    ["deploymentUrl", body.deploymentUrl],
    ["url", body.url],
    ["vercelProjectId", identity(body)],
  ];
  for (const [key, value] of fields) {
    if (
      (typeof value === "string" && value.length > 0) ||
      (typeof value === "number" && Number.isFinite(value))
    )
      evidence[key] = value;
  }
  return evidence;
}

function browserEvidence(result) {
  return {
    status:
      typeof result?.status === "number" && Number.isFinite(result.status)
        ? result.status
        : null,
    ready: result?.ready === true,
    canvas: result?.canvas === true,
    pageErrorCount: Array.isArray(result?.pageErrors)
      ? result.pageErrors.length
      : null,
  };
}

function requireBrowserReady(result, label) {
  if (!result || result.ready !== true)
    throw new PublicationAcceptanceError(
      `${label} browser did not reach data-ready state.`,
    );
  if (result.canvas !== true)
    throw new PublicationAcceptanceError(
      `${label} browser did not render a canvas.`,
    );
  if (!Array.isArray(result.pageErrors))
    throw new PublicationAcceptanceError(
      `${label} browser did not report page errors.`,
    );
  if (result.pageErrors.length > 0)
    throw new PublicationAcceptanceError(
      `${label} browser reported ${result.pageErrors.length} page error(s).`,
    );
}

async function publicSnapshot(transport, url, label) {
  const result = await transport.publicGet(url, label);
  const text = parsePublicText(result, label);
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch (error) {
    throw new PublicationAcceptanceError(
      `${label} did not return a JSON project snapshot.`,
      { cause: error },
    );
  }
  if (!snapshot || typeof snapshot !== "object")
    throw new PublicationAcceptanceError(
      `${label} returned an invalid project snapshot.`,
    );
  return snapshot;
}

function assertSnapshotMatches(snapshot, expected, label) {
  assert.equal(snapshot.revision, expected.revision, `${label} revision`);
  assert.equal(snapshot.title, expected.title, `${label} title`);
  const expectedMaterial = expected.entities?.find(
    (entity) => entity.id === "crystal-accept",
  )?.color;
  if (expectedMaterial !== undefined) {
    const actualMaterial = snapshot.entities?.find(
      (entity) => entity.id === "crystal-accept",
    )?.color;
    assert.equal(actualMaterial, expectedMaterial, `${label} material`);
  }
}

async function signedOutRelease(
  transport,
  release,
  expected,
  label,
  recordStep,
) {
  const pageResult = await transport.publicGet(
    release.deploymentUrl,
    `${label} page`,
  );
  assertPublicStatus(pageResult, `${label} page`);
  await recordStep(`${label} page`, pageResult);
  const browserResult = await transport.browserReady(
    release.deploymentUrl,
    `${label} browser`,
  );
  await recordStep(`${label} browser`, null, {
    browser: browserEvidence(browserResult),
  });
  requireBrowserReady(browserResult, label);
  const snapshot = await publicSnapshot(
    transport,
    projectSnapshotUrl(release.deploymentUrl),
    `${label} snapshot`,
  );
  await recordStep(`${label} snapshot`, null, {
    snapshot: {
      revision: snapshot.revision,
      title: snapshot.title,
      materialColor: snapshot.entities?.find(
        (entity) => entity.id === "crystal-accept",
      )?.color,
    },
  });
  assertSnapshotMatches(snapshot, expected, label);
  return {
    pageStatus: responseStatus(pageResult),
    browser: browserEvidence(browserResult),
    snapshot,
  };
}

async function waitForReady({
  transport,
  cookies,
  projectId,
  maxPolls,
  pollDelayMs,
  sleep,
  label,
  recordStep,
}) {
  let latest;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (attempt > 0 && pollDelayMs > 0) await sleep(pollDelayMs);
    const result = await transport.request(
      `/api/publish?projectId=${encodeURIComponent(projectId)}`,
      { cookie: cookies },
      `${label} status`,
    );
    await recordStep(`${label} status`, result);
    latest = requireResponse(`${label} status`, result);
    if (latest.state === "READY") {
      const url = latest.url;
      const publicDeployment = deploymentUrl(latest, `${label} status`);
      return {
        ...latest,
        url,
        deploymentUrl: publicDeployment,
      };
    }
    if (
      ["PROTECTED", "ERROR", "CANCELED"].includes(latest.state) ||
      latest.error
    )
      failResponse(`${label} status`, result);
  }
  throw new PublicationAcceptanceError(
    `${label} did not become READY within ${maxPolls} status checks.`,
  );
}

function saveBody(project, baseRevision, baseSnapshotToken) {
  return {
    project,
    baseRevision,
    baseSnapshotToken,
  };
}

/**
 * Run the deterministic account/cloud/publication sequence. `transport` is
 * deliberately injected so focused tests can cover failure paths without
 * creating accounts, saving data, or calling Vercel.
 */
export async function runPublicationAcceptance({
  transport,
  world,
  email,
  password,
  republish = false,
  maxPolls = 120,
  pollDelayMs = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress = async (_progress) => undefined,
}) {
  if (!transport || typeof transport.request !== "function")
    throw new TypeError("A publication transport is required.");
  if (typeof transport.publicGet !== "function")
    throw new TypeError(
      "Publication acceptance requires a signed-out public transport.",
    );
  if (typeof transport.browserReady !== "function")
    throw new TypeError(
      "Publication acceptance requires an injected signed-out browser transport.",
    );
  if (!world || typeof world !== "object")
    throw new TypeError("A publication world is required.");

  const progress = {
    account: { email },
    world: {
      id: typeof world.id === "string" ? world.id : null,
      revision: typeof world.revision === "number" ? world.revision : null,
      title: typeof world.title === "string" ? world.title : null,
    },
    steps: [],
    last: null,
  };
  const recordStep = async (step, response, extra = {}) => {
    const event = {
      step,
      ...(response ? responseEvidence(response) : {}),
      ...extra,
    };
    progress.last = event;
    progress.steps.push(event);
    await onProgress(structuredClone(progress));
  };
  await recordStep("start", null);

  const signupResult = await transport.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name: "Orbsie Publication Acceptance",
      }),
    },
    "sign-up",
  );
  await recordStep("sign-up", signupResult);
  requireResponse("sign-up", signupResult);
  const cookies = cookieFromSignup(signupResult);

  const firstWorld = structuredClone(world);
  firstWorld.revision = 1;
  progress.world = {
    id: firstWorld.id,
    revision: firstWorld.revision,
    title: firstWorld.title,
  };
  const saved = await transport.request(
    "/api/projects",
    {
      method: "PUT",
      cookie: cookies,
      body: JSON.stringify(saveBody(firstWorld, null, null)),
    },
    "cloud save revision 1",
  );
  await recordStep("cloud save revision 1", saved, {
    world: {
      id: firstWorld.id,
      revision: firstWorld.revision,
      title: firstWorld.title,
    },
  });
  const savedBody = requireResponse("cloud save revision 1", saved);
  assert.equal(savedBody.revision, 1, "cloud save revision 1");

  const submitted = await transport.request(
    "/api/publish",
    {
      method: "POST",
      cookie: cookies,
      body: JSON.stringify({
        projectId: firstWorld.id,
        revision: firstWorld.revision,
      }),
    },
    "publish revision 1",
  );
  await recordStep("publish revision 1", submitted, {
    world: {
      id: firstWorld.id,
      revision: firstWorld.revision,
      title: firstWorld.title,
    },
  });
  const submittedBody = requireResponse("publish revision 1", submitted);
  const firstReady = await waitForReady({
    transport,
    cookies,
    projectId: firstWorld.id,
    maxPolls,
    pollDelayMs,
    sleep,
    label: "publish revision 1",
    recordStep,
  });
  const firstPostProjectId = identity(submittedBody);
  const firstGetProjectId = identity(firstReady);
  const firstProjectId = compareProjectIdentity(
    submittedBody,
    firstReady,
    "publish revision 1",
    republish,
  );
  const firstRelease = {
    ...firstReady,
    deploymentId: firstReady.deploymentId ?? submittedBody.deploymentId,
    vercelProjectId: firstProjectId,
    publicUrl: firstReady.url,
    deploymentUrl: deploymentUrl(firstReady, "publish revision 1"),
  };
  if (!firstRelease.deploymentId)
    throw new PublicationAcceptanceError(
      "publish revision 1 did not return a deployment identity.",
    );
  const firstSignedOut = await signedOutRelease(
    transport,
    firstRelease,
    firstWorld,
    "first public release",
    recordStep,
  );

  const report = {
    first: {
      revision: firstWorld.revision,
      title: firstWorld.title,
      projectId: firstWorld.id,
      state: submittedBody.state,
      publicUrl: firstRelease.publicUrl,
      deploymentUrl: firstRelease.deploymentUrl,
      deploymentId: firstRelease.deploymentId,
      vercelProjectId: firstRelease.vercelProjectId,
      postVercelProjectId: firstPostProjectId,
      getVercelProjectId: firstGetProjectId,
      servedRevision: firstReady.servedRevision ?? null,
      signedOutSnapshot: firstSignedOut.snapshot,
    },
    republish: null,
  };

  if (!republish) return report;

  if (!firstRelease.vercelProjectId)
    throw new PublicationAcceptanceError(
      "Republish mapping could not be verified: publication responses do not expose the Vercel project identity (expected vercelProjectId).",
    );
  const secondWorld = republishWorld(firstWorld);
  progress.world = {
    id: secondWorld.id,
    revision: secondWorld.revision,
    title: secondWorld.title,
  };
  const secondSaved = await transport.request(
    "/api/projects",
    {
      method: "PUT",
      cookie: cookies,
      body: JSON.stringify(
        saveBody(secondWorld, 1, savedBody.snapshotToken ?? null),
      ),
    },
    "cloud save revision 2",
  );
  await recordStep("cloud save revision 2", secondSaved, {
    world: {
      id: secondWorld.id,
      revision: secondWorld.revision,
      title: secondWorld.title,
    },
  });
  const secondSavedBody = requireResponse("cloud save revision 2", secondSaved);
  assert.equal(secondSavedBody.revision, 2, "cloud save revision 2");

  const secondSubmitted = await transport.request(
    "/api/publish",
    {
      method: "POST",
      cookie: cookies,
      body: JSON.stringify({
        projectId: secondWorld.id,
        revision: secondWorld.revision,
      }),
    },
    "publish revision 2",
  );
  await recordStep("publish revision 2", secondSubmitted, {
    world: {
      id: secondWorld.id,
      revision: secondWorld.revision,
      title: secondWorld.title,
    },
  });
  const secondSubmittedBody = requireResponse(
    "publish revision 2",
    secondSubmitted,
  );
  const secondProjectId = identity(secondSubmittedBody);
  if (!secondProjectId)
    throw new PublicationAcceptanceError(
      "Republish mapping could not be verified: revision 2 did not return the Vercel project identity (expected vercelProjectId).",
    );
  assert.equal(
    secondProjectId,
    firstRelease.vercelProjectId,
    "republish must keep the same Vercel project",
  );

  const servedDuringUpdate = secondSubmittedBody.servedRevision;
  if (!["QUEUED", "BUILDING", "VERIFYING"].includes(secondSubmittedBody.state))
    throw new PublicationAcceptanceError(
      `Republish mapping cannot claim a previous-release window from state ${secondSubmittedBody.state ?? "unknown"}.`,
    );
  assert.equal(
    servedDuringUpdate,
    1,
    "the previous public revision must remain served while revision 2 is queued",
  );
  const previousRelease = await signedOutRelease(
    transport,
    firstRelease,
    firstWorld,
    "previous public release during republish",
    recordStep,
  );

  const secondReady = await waitForReady({
    transport,
    cookies,
    projectId: secondWorld.id,
    maxPolls,
    pollDelayMs,
    sleep,
    label: "publish revision 2",
    recordStep,
  });
  const secondGetProjectId = identity(secondReady);
  compareProjectIdentity(
    secondSubmittedBody,
    secondReady,
    "publish revision 2",
    true,
  );
  const secondRelease = {
    ...secondReady,
    deploymentId: secondReady.deploymentId ?? secondSubmittedBody.deploymentId,
    vercelProjectId: secondProjectId,
    publicUrl: secondReady.url,
    deploymentUrl: deploymentUrl(secondReady, "publish revision 2"),
  };
  if (!secondRelease.deploymentId)
    throw new PublicationAcceptanceError(
      "publish revision 2 did not return a deployment identity.",
    );
  assert.notEqual(
    secondRelease.deploymentId,
    firstRelease.deploymentId,
    "republish must create a newer deployment",
  );
  assert.equal(secondReady.servedRevision, 2, "republish served revision");
  assert.equal(
    secondRelease.publicUrl,
    firstRelease.publicUrl,
    "share URL remains stable",
  );

  const finalRelease = await signedOutRelease(
    transport,
    secondRelease,
    secondWorld,
    "final public release",
    recordStep,
  );
  return {
    ...report,
    republish: {
      revision: secondWorld.revision,
      title: secondWorld.title,
      materialColor: secondWorld.entities.find(
        (entity) => entity.id === "crystal-accept",
      )?.color,
      projectId: secondWorld.id,
      state: secondSubmittedBody.state,
      vercelProjectId: secondProjectId,
      deploymentId: secondRelease.deploymentId,
      publicUrl: secondRelease.publicUrl,
      deploymentUrl: secondRelease.deploymentUrl,
      servedRevision: secondReady.servedRevision,
      postVercelProjectId: secondProjectId,
      getVercelProjectId: secondGetProjectId,
      previousRelease: previousRelease.snapshot,
      finalSnapshot: finalRelease.snapshot,
    },
  };
}
