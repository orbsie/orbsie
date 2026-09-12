import assert from "node:assert/strict";

const PENDING_PUBLICATION_STATES = new Set([
  "INITIALIZING",
  "QUEUED",
  "BUILDING",
  "VERIFYING",
]);

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

function responseCode(result) {
  const body = responseBody(result);
  return typeof body.code === "string" ? body.code.slice(0, 120) : undefined;
}

function responseMessage(result) {
  const body = responseBody(result);
  return typeof body.message === "string"
    ? body.message.slice(0, 240)
    : undefined;
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
  const code = responseCode(result);
  const message = responseMessage(result);
  const detail = error
    ? `: ${error}`
    : code
      ? `: ${code}${message ? ` — ${message}` : ""}`
      : message
        ? `: ${message}`
        : state
          ? `: ${state}`
          : "";
  throw new PublicationAcceptanceError(
    `${label} failed (HTTP ${status})${detail}`,
    { status, state, code },
  );
}

function requireResponse(label, result) {
  if (!responseIsOk(result)) failResponse(label, result);
  const state = responseState(result);
  const error = responseError(result);
  if (["PROTECTED", "ERROR", "CANCELED"].includes(state) || error)
    throw new PublicationAcceptanceError(
      `${label} failed${state ? ` (${state})` : ""}${error ? `: ${error}` : ""}`,
      { status: responseStatus(result), state, code: responseCode(result) },
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
    ["code", responseCode(result)],
    [
      "message",
      responseStatus(result) >= 400 ? responseMessage(result) : undefined,
    ],
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
  let secondSubmittedBody;
  try {
    secondSubmittedBody = requireResponse(
      "publish revision 2",
      secondSubmitted,
    );
  } catch (error) {
    const previousReleaseAfterFailure = await signedOutRelease(
      transport,
      firstRelease,
      firstWorld,
      "previous public release after failed republish",
      recordStep,
    );
    await recordStep("failed republish previous-release check", null, {
      failedReplacement: {
        state: "failed",
        previousRelease: {
          deploymentId: firstRelease.deploymentId,
          deploymentUrl: firstRelease.deploymentUrl,
          ...previousReleaseAfterFailure,
        },
      },
    });
    throw error;
  }
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
  if (!PENDING_PUBLICATION_STATES.has(secondSubmittedBody.state)) {
    await recordStep("republish pending-window missed", null, {
      pendingWindow: {
        observed: false,
        state: secondSubmittedBody.state ?? null,
        servedRevision: servedDuringUpdate ?? null,
        note: "The replacement was already terminal; no queued previous-release window was observed.",
      },
    });
    throw new PublicationAcceptanceError(
      `Republish mapping cannot claim a previous-release window from state ${secondSubmittedBody.state ?? "unknown"}.`,
    );
  }
  if (servedDuringUpdate !== 1) {
    await recordStep("republish pending-window invalid", null, {
      pendingWindow: {
        observed: false,
        state: secondSubmittedBody.state,
        servedRevision: servedDuringUpdate ?? null,
        note: "The replacement was pending, but the owner status did not retain revision 1 as the served release.",
      },
    });
  }
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
  const pendingWindow = {
    observed: true,
    state: secondSubmittedBody.state,
    servedRevision: servedDuringUpdate,
    previousRelease: {
      deploymentId: firstRelease.deploymentId,
      deploymentUrl: firstRelease.deploymentUrl,
      browser: previousRelease.browser,
      snapshot: previousRelease.snapshot,
    },
  };
  await recordStep("republish pending-window observed", null, {
    pendingWindow,
  });

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
      pendingWindow,
      finalSnapshot: finalRelease.snapshot,
    },
  };
}

/**
 * Resume an already-submitted publication using only sign-in, one owner status
 * read, and signed-out public reads. This never saves a project or submits a
 * deployment, so a late resume cannot create another revision or deployment.
 */
export async function resumePublicationAcceptance({
  transport,
  projectId,
  email,
  password,
  expectedVercelProjectId,
  firstRelease,
  secondRelease,
  firstWorld,
  secondWorld,
  onProgress = async (_progress) => undefined,
}) {
  if (!transport || typeof transport.request !== "function")
    throw new TypeError("A publication transport is required.");
  if (typeof transport.publicGet !== "function")
    throw new TypeError(
      "Publication resume requires a signed-out public transport.",
    );
  if (typeof transport.browserReady !== "function")
    throw new TypeError(
      "Publication resume requires an injected signed-out browser transport.",
    );
  if (!projectId || !email || !password)
    throw new TypeError("Publication resume requires project credentials.");
  if (!firstRelease?.deploymentUrl || !secondRelease?.deploymentUrl)
    throw new TypeError("Publication resume requires both deployment URLs.");
  assert.notEqual(
    firstRelease.deploymentId,
    secondRelease.deploymentId,
    "resume deployments must remain distinct",
  );
  assert.equal(
    firstRelease.vercelProjectId,
    secondRelease.vercelProjectId,
    "resume deployment project mappings",
  );
  assert.equal(
    firstRelease.vercelProjectId,
    expectedVercelProjectId,
    "resume expected Vercel project mapping",
  );

  const progress = {
    account: { email },
    world: {
      id: projectId,
      revisions: [firstWorld?.revision ?? null, secondWorld?.revision ?? null],
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
  await recordStep("resume start", null);

  const signIn = await transport.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    "resume sign-in",
  );
  await recordStep("resume sign-in", signIn);
  requireResponse("resume sign-in", signIn);
  const cookies = cookieFromSignup(signIn);

  const statusResult = await transport.request(
    `/api/publish?projectId=${encodeURIComponent(projectId)}`,
    { cookie: cookies },
    "resume publication status",
  );
  await recordStep("resume publication status", statusResult);
  const statusBody = requireResponse("resume publication status", statusResult);
  const getProjectId = identity(statusBody);
  if (!getProjectId)
    throw new PublicationAcceptanceError(
      "Resume mapping could not be verified: status GET did not expose vercelProjectId.",
    );
  assert.equal(
    getProjectId,
    expectedVercelProjectId,
    "resume status GET Vercel project mapping",
  );
  const state = statusBody.state;
  if (state !== "READY" && !PENDING_PUBLICATION_STATES.has(state))
    throw new PublicationAcceptanceError(
      `Resume publication returned unexpected state ${state ?? "unknown"}.`,
      { state },
    );
  if (state === "READY") {
    const currentDeployment = deploymentUrl(
      statusBody,
      "resume publication status",
    );
    assert.equal(
      currentDeployment,
      secondRelease.deploymentUrl,
      "resume status GET revision-2 deployment URL",
    );
    assert.equal(
      statusBody.servedRevision,
      secondWorld.revision,
      "resume status GET served revision",
    );
  } else assert.equal(statusBody.servedRevision, firstWorld.revision);
  const statusEvidence = {
    state,
    servedRevision: statusBody.servedRevision ?? null,
    deploymentUrl: statusBody.deploymentUrl ?? null,
    vercelProjectId: getProjectId,
  };

  const oldRelease = await signedOutRelease(
    transport,
    firstRelease,
    firstWorld,
    "resumed previous public release",
    recordStep,
  );
  if (state !== "READY")
    return {
      projectId,
      vercelProjectId: getProjectId,
      state,
      status: statusEvidence,
      pendingWindow: {
        observed: true,
        state,
        servedRevision: statusBody.servedRevision,
      },
      oldRelease,
      finalRelease: null,
    };

  const finalRelease = await signedOutRelease(
    transport,
    secondRelease,
    secondWorld,
    "resumed final public release",
    recordStep,
  );
  return {
    projectId,
    vercelProjectId: getProjectId,
    state,
    status: statusEvidence,
    pendingWindow: {
      observed: false,
      state,
      note: "Resume began after the pending interval; no late read proves its prior window.",
    },
    oldRelease,
    finalRelease,
  };
}
