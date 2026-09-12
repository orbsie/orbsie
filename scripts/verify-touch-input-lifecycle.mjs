import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix as posixPath, resolve } from "node:path";
import { unzipSync } from "fflate";

const base = process.env.TEST_URL ?? "http://127.0.0.1:3027";
const output = resolve(
  process.env.TOUCH_INPUT_EVIDENCE ?? "docs/evidence/input-touch-lifecycle",
);
await mkdir(output, { recursive: true });

const game = {
  variables: [],
  rules: [
    {
      id: "right",
      trigger: { type: "input", action: "right" },
      conditions: [],
      actions: [{ type: "add_score", amount: 7 }],
    },
    {
      id: "jump",
      trigger: { type: "input", action: "jump" },
      conditions: [],
      actions: [{ type: "add_score", amount: 11 }],
    },
    {
      id: "up",
      trigger: { type: "input", action: "up" },
      conditions: [],
      actions: [{ type: "win" }],
    },
    {
      id: "left",
      trigger: { type: "input", action: "left" },
      conditions: [],
      actions: [{ type: "lose" }],
    },
  ],
};
const commands = [
  {
    type: "reserve_entity",
    entity: {
      id: "touch-tree",
      label: "Touch tree",
      position: [-2, 0, 0],
      scale: [1, 1, 1],
      color: "#72a864",
      stage: "seed",
      behavior: { type: "static" },
    },
  },
  {
    type: "set_geometry",
    id: "touch-tree",
    geometry: { kind: "tree", detail: "refined" },
  },
  { type: "set_game", game },
  { type: "commit_revision", message: "Touch controls are ready." },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  status: "running",
  mode: "browser-touch-emulation",
  actualDevice: false,
  syntheticPointerHandlers: false,
  captureOverride: false,
  url: base,
  fixtureGenerationRequests: 0,
  liveInferenceCalls: 0,
  externalRequests: [],
  pageErrors: [],
  openGates: [],
  editor: {
    status: "not-started",
    simultaneousActions: false,
    captureObserved: false,
    captureReleaseApiObserved: false,
    captureReleaseEventObserved: false,
    ordinaryTouchRelease: false,
    lostPointerCaptureRelease: false,
    touchCancelLostCapture: false,
    otherActionHeldAfterOrdinaryRelease: false,
    backgroundReset: false,
    buttonSpaceActivation: false,
    textEntryDoesNotMove: false,
  },
  standalone: {
    status: "not-started",
    simultaneousActions: false,
    captureObserved: false,
    captureReleaseApiObserved: false,
    captureReleaseEventObserved: false,
    ordinaryTouchRelease: false,
    lostPointerCaptureRelease: false,
    touchCancelLostCapture: false,
    otherActionHeldAfterOrdinaryRelease: false,
    backgroundReset: false,
  },
  evidence: [],
};
let standaloneServer;

function trackPage(page, sameOrigin) {
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    const requestURL = new URL(request.url());
    if (requestURL.protocol === "data:" || requestURL.origin === sameOrigin)
      return;
    report.externalRequests.push(request.url());
  });
}

async function installEditorRoutes(context) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
    if (path === "/api/generate") {
      report.fixtureGenerationRequests += 1;
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
}

async function inputEvents(page) {
  return page.evaluate(() => window.__touchInputEvents ?? []);
}

async function buttonCenter(page, name) {
  const box = await page
    .getByRole("button", { name, exact: true })
    .boundingBox();
  if (!box) throw Error(`Missing touch button ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function installInputObserver(context) {
  await context.addInitScript(() => {
    window.__touchInputEvents = [];
    window.__touchPointerEvents = [];
    window.addEventListener("orbsie-input", (event) => {
      const detail = event.detail;
      window.__touchInputEvents.push({
        key: detail?.key,
        down: detail?.down,
        pointerId: detail?.pointerId,
      });
    });
    window.addEventListener(
      "pointerdown",
      (event) =>
        window.__touchPointerEvents.push({
          type: event.type,
          pointerId: event.pointerId,
          target: event.target?.getAttribute?.("aria-label") ?? null,
        }),
      true,
    );
    window.addEventListener(
      "gotpointercapture",
      (event) =>
        window.__touchPointerEvents.push({
          type: event.type,
          pointerId: event.pointerId,
          target: event.target?.getAttribute?.("aria-label") ?? null,
        }),
      true,
    );
    window.addEventListener(
      "lostpointercapture",
      (event) =>
        window.__touchPointerEvents.push({
          type: event.type,
          pointerId: event.pointerId,
          target: event.target?.getAttribute?.("aria-label") ?? null,
        }),
      true,
    );
  });
}

async function dismissNotice(page) {
  const dismiss = page.getByRole("button", { name: "Dismiss message" });
  if ((await dismiss.count()) > 0 && (await dismiss.first().isVisible()))
    await dismiss.first().click();
}

async function touchPoint(page, label, pointerId) {
  const box = await buttonCenter(page, label);
  const x = box.x;
  const y = box.y;
  const hit = await page.evaluate(
    ({ label, x, y }) => {
      const stack = document.elementsFromPoint(x, y).map((element) => ({
        tag: element.tagName,
        label: element.getAttribute("aria-label"),
        className: String(element.className),
      }));
      return {
        stack,
        buttonIndex: stack.findIndex((element) => element.label === label),
      };
    },
    { label, x, y },
  );
  if (hit.buttonIndex < 0)
    throw Error(
      `Touch coordinate for ${label} missed the control; stack=${JSON.stringify(hit.stack.slice(0, 4))}`,
    );
  return { x, y, id: pointerId };
}

async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await page.bringToFront();
  return cdp;
}

async function dispatchTouch(cdp, type, touchPoints) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
}

async function runTouchSequence(page, names, result) {
  await dismissNotice(page);
  const cdp = await touchSession(page);
  const right = await touchPoint(page, names.right, 101);
  const jump = await touchPoint(page, names.jump, 102);
  await dispatchTouch(cdp, "touchStart", [right]);
  await expect
    .poll(async () => (await inputEvents(page)).filter((event) => event.down))
    .toContainEqual(expect.objectContaining({ key: "d", down: true }));
  const rightDown = (await inputEvents(page)).find(
    (event) => event.key === "d" && event.down === true,
  );
  if (!rightDown) throw Error("Real touch did not produce a movement input.");
  result.captureObserved = await page.evaluate(
    ({ label, pointerId }) => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      return Boolean(button?.hasPointerCapture(pointerId));
    },
    { label: names.right, pointerId: rightDown.pointerId },
  );
  if (!result.captureObserved)
    throw Error("Real touch did not leave pointer capture on the control.");
  await dispatchTouch(cdp, "touchStart", [right, jump]);
  result.eventsBeforeScore = await inputEvents(page);
  await expect(page.locator(".score, .game-hud strong")).toHaveText(
    names.standalone ? "Score: 18" : "18",
    { timeout: 5000 },
  );
  const downEvents = await inputEvents(page);
  const rightDownAfterScore = downEvents.find(
    (event) => event.key === "d" && event.down === true,
  );
  const jumpDown = downEvents.find(
    (event) => event.key === " " && event.down === true,
  );
  if (
    !rightDownAfterScore ||
    !jumpDown ||
    rightDownAfterScore.pointerId === jumpDown.pointerId
  )
    throw Error("Simultaneous touch actions did not retain distinct pointers.");
  result.simultaneousActions = true;
  await dispatchTouch(cdp, "touchMove", [right, jump]);
  await page.evaluate(
    ({ label, pointerId }) => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      if (!button) throw Error(`Missing touch control ${label}`);
      button.releasePointerCapture(pointerId);
    },
    { label: names.right, pointerId: rightDownAfterScore.pointerId },
  );
  await dispatchTouch(cdp, "touchMove", [
    { ...right, x: right.x + 1 },
    jump,
  ]);
  result.captureReleaseApiObserved = !(await page.evaluate(
    ({ label, pointerId }) => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      return Boolean(button?.hasPointerCapture(pointerId));
    },
    { label: names.right, pointerId: rightDownAfterScore.pointerId },
  ));
  if (!result.captureReleaseApiObserved)
    throw Error("releasePointerCapture did not clear the active capture.");
  result.captureReleaseEventObserved = await page.evaluate(
    (pointerId) =>
      (window.__touchPointerEvents ?? []).some(
        (event) =>
          event.type === "lostpointercapture" &&
          event.pointerId === pointerId,
      ),
    rightDownAfterScore.pointerId,
  );
  if (result.captureReleaseEventObserved) {
    await expect
      .poll(async () => (await inputEvents(page)).filter((event) => !event.down))
      .toContainEqual({
        key: "d",
        down: false,
        pointerId: rightDownAfterScore.pointerId,
      });
    result.lostPointerCaptureRelease = true;
  }
  await dispatchTouch(cdp, "touchEnd", [right]);
  await expect
    .poll(async () => (await inputEvents(page)).filter((event) => !event.down))
    .toContainEqual({
      key: "d",
      down: false,
      pointerId: rightDownAfterScore.pointerId,
    });
  const afterCaptureLoss = await inputEvents(page);
  if (
    afterCaptureLoss.some(
      (event) => event.key === " " && event.down === false,
    )
  )
    throw Error("Releasing one captured pointer released the other action.");
  result.otherActionHeldAfterOrdinaryRelease = true;
  result.ordinaryTouchRelease = true;
  await dispatchTouch(cdp, "touchEnd", [jump]);
  const cancelPoint = { ...jump, id: 103 };
  await dispatchTouch(cdp, "touchStart", [cancelPoint]);
  await expect
    .poll(async () => (await inputEvents(page)).find(
      (event) =>
        event.key === " " &&
        event.down === true &&
        event.pointerId !== jumpDown.pointerId,
    ))
    .toBeTruthy();
  const cancelDown = (await inputEvents(page)).find(
    (event) =>
      event.key === " " &&
      event.down === true &&
      event.pointerId !== jumpDown.pointerId,
  );
  if (!cancelDown) throw Error("Touch cancel setup did not produce a jump input.");
  await dispatchTouch(cdp, "touchCancel", []);
  await expect
    .poll(async () => page.evaluate(() => window.__touchPointerEvents ?? []))
    .toContainEqual(
      expect.objectContaining({
        type: "lostpointercapture",
        pointerId: cancelDown.pointerId,
      }),
    );
  await expect
    .poll(async () => (await inputEvents(page)).filter((event) => !event.down))
    .toContainEqual({
      key: " ",
      down: false,
      pointerId: cancelDown.pointerId,
    });
  result.touchCancelLostCapture = true;
}

async function runBackgroundReset(page, result) {
  await dismissNotice(page);
  const cdp = await touchSession(page);
  const right = await touchPoint(page, "Move d", 201).catch(() =>
    touchPoint(page, "Right", 201),
  );
  await dispatchTouch(cdp, "touchStart", [right]);
  const first = await page.locator(".score, .game-hud strong").innerText();
  const expectedFirst = first.startsWith("Score:") ? "Score: 7" : "7";
  await expect(page.locator(".score, .game-hud strong")).toHaveText(
    expectedFirst,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await dispatchTouch(cdp, "touchEnd", []);
  const nextRight = await touchPoint(
    page,
    right.id === 201 && (await page.getByRole("button", { name: "Move d", exact: true }).count())
      ? "Move d"
      : "Right",
    202,
  );
  await dispatchTouch(cdp, "touchStart", [nextRight]);
  const expected = first.startsWith("Score:") ? "Score: 14" : "14";
  await expect(page.locator(".score, .game-hud strong")).toHaveText(expected);
  result.backgroundReset = true;
  await dispatchTouch(cdp, "touchEnd", []);
}

async function openStandalone(zipPath) {
  const files = unzipSync(await readFile(zipPath));
  standaloneServer = createServer((request, response) => {
    const requestedPath = new URL(
      request.url ?? "/",
      "http://standalone.local",
    ).pathname.slice(1);
    const path = requestedPath
      ? posixPath.normalize(requestedPath)
      : "index.html";
    if (path.startsWith("../") || path === "..") {
      response.writeHead(400).end();
      return;
    }
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    const extension = path.split(".").pop();
    response.setHeader(
      "Content-Type",
      {
        css: "text/css",
        glb: "model/gltf-binary",
        html: "text/html",
        js: "text/javascript",
        json: "application/json",
        wasm: "application/wasm",
      }[extension] ?? "application/octet-stream",
    );
    response.writeHead(200).end(bytes);
  });
  await new Promise((resolveServer, rejectServer) => {
    standaloneServer.once("error", rejectServer);
    standaloneServer.listen(0, "127.0.0.1", resolveServer);
  });
  return `http://127.0.0.1:${standaloneServer.address().port}`;
}

try {
  const editorContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installInputObserver(editorContext);
  await installEditorRoutes(editorContext);
  const editor = await editorContext.newPage();
  trackPage(editor, new URL(base).origin);
  await editor.goto(base);
  await editor
    .getByPlaceholder("What experience to build?")
    .fill("Create a simple input game.");
  await editor.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    editor.getByText("Touch controls are ready.", { exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Move d", exact: true }),
  ).toBeVisible();
  await runTouchSequence(
    editor,
    { right: "Move d", jump: "Jump", standalone: false },
    report.editor,
  );
  await editor
    .getByRole("button", { name: "Restart game", exact: true })
    .click();
  await runBackgroundReset(editor, report.editor);
  await editor
    .getByRole("button", { name: "Restart game", exact: true })
    .focus();
  await editor.keyboard.press("Space");
  await expect(editor.locator(".game-hud strong")).toHaveText("0");
  report.editor.buttonSpaceActivation = true;
  await editor.locator("#prompt").focus();
  await editor.keyboard.press("d");
  await expect(editor.locator(".game-hud strong")).toHaveText("0");
  report.editor.textEntryDoesNotMove = true;
  await editor.screenshot({
    path: join(output, "editor-touch.png"),
    fullPage: true,
  });
  report.evidence.push("editor-touch.png");

  await editor.getByRole("button", { name: "Share Orb", exact: true }).click();
  const download = await Promise.all([
    editor.waitForEvent("download"),
    editor.getByRole("button", { name: /Download your world/ }).click(),
  ]).then(([event]) => event);
  const zipPath = join(output, "world.zip");
  await download.saveAs(zipPath);
  report.evidence.push("world.zip");
  await editorContext.close();

  const standaloneOrigin = await openStandalone(zipPath);
  const standaloneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installInputObserver(standaloneContext);
  await standaloneContext.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== standaloneOrigin ||
      !["GET", "HEAD"].includes(request.method())
    )
      return route.abort();
    return route.continue();
  });
  const standalone = await standaloneContext.newPage();
  trackPage(standalone, standaloneOrigin);
  await standalone.goto(standaloneOrigin);
  await expect(standalone.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await runTouchSequence(
    standalone,
    { right: "Right", jump: "Jump", standalone: true },
    report.standalone,
  );
  await standalone.getByRole("button", { name: /Restart/ }).click();
  await runBackgroundReset(standalone, report.standalone);
  await standalone.screenshot({
    path: join(output, "standalone-touch.png"),
    fullPage: true,
  });
  report.evidence.push("standalone-touch.png");
  await standaloneContext.close();
  report.standalone.status = "passed";
  report.editor.status = "passed";
  if (
    !report.editor.lostPointerCaptureRelease ||
    !report.standalone.lostPointerCaptureRelease
  )
    report.openGates.push(
      "Chromium CDP releasePointerCapture cleared capture but did not emit lostpointercapture; ordinary touch release and real touchCancel are recorded separately.",
    );
  report.status = report.openGates.length ? "partial" : "passed";
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw error;
} finally {
  if (standaloneServer)
    await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  await browser.close();
}
