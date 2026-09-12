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
  toastLayout: {
    status: "not-started",
  },
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
    toastTouchWithNotice: false,
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
    toastTouchWithNotice: false,
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
  let failNextGeneration = false;
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
    if (path === "/api/generate") {
      report.fixtureGenerationRequests += 1;
      if (failNextGeneration) {
        failNextGeneration = false;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture generation failed." }),
        });
      }
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
  return {
    failNextGeneration() {
      failNextGeneration = true;
    },
  };
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

async function topmostButtonAt(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw Error("Expected visible toast or touch control.");
  const hit = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const button = target?.closest("button");
      return {
        point: { x, y },
        viewport: {
          width: innerWidth,
          height: innerHeight,
          pointerCoarse: matchMedia("(pointer: coarse)").matches,
        },
        target: target
          ? {
              tag: target.tagName,
              className: String(target.className),
            }
          : null,
        button: button
          ? {
              label: button.getAttribute("aria-label"),
              text: button.textContent?.trim(),
            }
          : null,
      };
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  return { box, ...hit };
}

async function waitForStableLayout(page) {
  await page.evaluate(async () => {
    const selectors = [".toast", ".chat-panel", ".touch-controls"];
    const read = () =>
      selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect
          ? [rect.x, rect.y, rect.width, rect.height].map((value) =>
              Number(value.toFixed(3)),
            )
          : null;
      });
    let previous = read();
    let stableFrames = 0;
    for (let frame = 0; frame < 90; frame += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      const current = read();
      const stable = current.every((box, index) => {
        const prior = previous[index];
        return (
          box &&
          prior &&
          box.every((value, valueIndex) => Math.abs(value - prior[valueIndex]) < 0.1)
        );
      });
      stableFrames = stable ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames >= 3) return;
    }
    throw new Error("Timed out waiting for touch layout transitions to settle.");
  });
}

async function assertToastLayout(page, result, mode) {
  await expect(page.locator(".toast")).toBeVisible();
  await waitForStableLayout(page);
  const expectedSheet = mode.includes("Open") ? "sheet-open" : "sheet-closed";
  const layoutState = await page.evaluate(({ expectedSheet }) => {
    const boxFor = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const hitFor = (element) => {
      const box = boxFor(element);
      if (!box) return null;
      const target = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      const button = target?.closest("button");
      return {
        box,
        point: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        target: target
          ? { tag: target.tagName, className: String(target.className) }
          : null,
        button: button
          ? {
              label: button.getAttribute("aria-label"),
              text: button.textContent?.trim(),
            }
          : null,
      };
    };
    const buttonByLabel = (label) =>
      [...document.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === label,
      );
    const buttonByText = (text) =>
      [...document.querySelectorAll("button")].find(
        (button) =>
          !button.hidden &&
          (button.textContent?.trim() === text ||
            button.getAttribute("aria-label") === text),
      );
    const app = document.querySelector("main.app");
    const touch = document.querySelector(".touch-controls");
    const toast = document.querySelector(".toast");
    const composer = document.querySelector(".chat-panel");
    const toolbar = document.querySelector(".play-toolbar");
    const hud = document.querySelector(".game-hud");
    const styleFor = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        position: style.position,
        height: style.height,
        minHeight: style.minHeight,
        top: style.top,
        bottom: style.bottom,
      };
    };
    return {
      appClass: app?.className ?? "",
      expectedSheet,
      app: boxFor(app),
      appStyle: styleFor(app),
      touchStyle: styleFor(touch),
      toastStyle: styleFor(toast),
      composerStyle: styleFor(composer),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        pointerCoarse: matchMedia("(pointer: coarse)").matches,
      },
      boxes: {
        toast: boxFor(toast),
        composer: boxFor(composer),
        toolbar: boxFor(toolbar),
        hud: boxFor(hud),
        right: hitFor(buttonByLabel("Move d")),
        jump: hitFor(buttonByLabel("Jump")),
        actions: Object.fromEntries(
          ["Try again", "Use last working", "Dismiss message"]
            .map((name) => [name, hitFor(buttonByText(name))])
            .filter(([, value]) => value),
        ),
      },
    };
  }, { expectedSheet });
  const { toast: toastBox, composer: composerBox, right, jump, actions } =
    layoutState.boxes;
  if (!toastBox || !right || !jump)
    throw Error(`Toast or touch controls are not measurable in ${mode}.`);
  const expected = (value, label) =>
    value.button?.label === label || value.button?.text === label;
  const overlaps = (first, second) =>
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;
  if (!layoutState.appClass.split(/\s+/).includes(expectedSheet))
    throw Error(
      `Unexpected composer state in ${mode}: ${JSON.stringify({ expectedSheet, appClass: layoutState.appClass })}`,
    );
  if (overlaps(toastBox, right.box) || overlaps(toastBox, jump.box))
    throw Error(
      `Toast overlaps a touch control in ${mode}: ${JSON.stringify({ toastBox, right: right.box, jump: jump.box })}`,
    );
  if (composerBox && (overlaps(composerBox, right.box) || overlaps(composerBox, jump.box)))
    throw Error(
      `Composer overlaps a touch control in ${mode}: ${JSON.stringify({ composerBox, right: right.box, jump: jump.box })}`,
    );
  const insideViewport = (box) =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= layoutState.viewport.width &&
    box.y + box.height <= layoutState.viewport.height;
  if (
    !layoutState.app ||
    layoutState.app.height < layoutState.viewport.height - 1 ||
    !layoutState.boxes.toolbar ||
    !layoutState.boxes.hud ||
    layoutState.boxes.toolbar.width <= 0 ||
    layoutState.boxes.toolbar.height <= 0 ||
    layoutState.boxes.hud.width <= 0 ||
    layoutState.boxes.hud.height <= 0 ||
    !insideViewport(layoutState.boxes.toolbar) ||
    !insideViewport(layoutState.boxes.hud)
  )
    throw Error(
      `Play surface or editor chrome is not fully visible in ${mode}: ${JSON.stringify({
        app: layoutState.app,
        viewport: layoutState.viewport,
        toolbar: layoutState.boxes.toolbar,
        hud: layoutState.boxes.hud,
      })}`,
    );
  if (!insideViewport(toastBox) || !insideViewport(right.box) || !insideViewport(jump.box))
    throw Error(
      `Toast or touch control is outside the ${mode} viewport: ${JSON.stringify({ toastBox, right: right.box, jump: jump.box })}`,
    );
  for (const [label, value] of Object.entries(actions))
    if (!insideViewport(value.box))
      throw Error(
        `Toast action ${label} is outside the ${mode} viewport: ${JSON.stringify(value.box)}`,
      );
  if (!expected(right, "Move d") || !expected(jump, "Jump"))
    throw Error(
      `Toast blocks touch controls in ${mode}: ${JSON.stringify({ right, jump })}`,
    );
  for (const [label, value] of Object.entries(actions))
    if (!expected(value, label))
      throw Error(
        `Toast action ${label} is not hit-testable in ${mode}: ${JSON.stringify(value)}`,
      );
  result[mode] = {
    toast: toastBox,
    composer: composerBox,
    layout: layoutState,
    appClass: layoutState.appClass,
    controls: { right, jump },
    actions,
    viewport: layoutState.viewport,
  };
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
  const noticeVisible = await page.locator(".toast").isVisible().catch(() => false);
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
  if (noticeVisible) result.toastTouchWithNotice = true;
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
  const editorRoutes = await installEditorRoutes(editorContext);
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
  await assertToastLayout(editor, report.toastLayout, "successClosed");
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
  await editor.getByRole("button", { name: "Play", exact: true }).click();
  await editor.locator(".sheet-handle").click();
  editorRoutes.failNextGeneration();
  await editor.locator("#prompt").fill("Trigger a bounded fixture failure.");
  await editor.locator("form.prompt-form").evaluate((form) => form.requestSubmit());
  await expect(editor.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await assertToastLayout(editor, report.toastLayout, "recoveryOpen");
  await editor.setViewportSize({ width: 844, height: 390 });
  await assertToastLayout(editor, report.toastLayout, "recoveryLandscapeOpen");
  await editor.screenshot({
    path: join(output, "toast-layout-landscape-open.png"),
    fullPage: true,
  });
  report.evidence.push("toast-layout-landscape-open.png");
  await editor.setViewportSize({ width: 390, height: 844 });
  await editor.locator(".sheet-handle").click();
  await assertToastLayout(editor, report.toastLayout, "recoveryClosed");
  await editor.setViewportSize({ width: 844, height: 390 });
  await assertToastLayout(editor, report.toastLayout, "recoveryLandscapeClosed");
  await editor.screenshot({
    path: join(output, "toast-layout.png"),
    fullPage: true,
  });
  report.evidence.push("toast-layout.png");
  await editor.setViewportSize({ width: 390, height: 844 });
  await editor.getByRole("button", { name: "Dismiss message" }).click();
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
  report.toastLayout.status = "passed";
  report.toastLayout.touchWithVisibleSuccess = report.editor.toastTouchWithNotice;
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
  await writeFile(
    join(output, "failure-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw error;
} finally {
  if (standaloneServer)
    await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  await browser.close();
}
