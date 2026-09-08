import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
const dir =
  process.env.ORBSIE_GAME_ACTIONS_EVIDENCE_DIRECTORY ??
  "docs/evidence/game-actions";
await mkdir(dir, { recursive: true });
const variable = (name, value) => ({
  operand: { type: "variable", name },
  comparison: "eq",
  value,
});
const rule = (id, trigger, actions, conditions = []) => ({
  id,
  trigger,
  actions,
  conditions,
});
const input = (action) => ({ type: "input", action });
const game = {
  variables: [
    { name: "armed", initial: 0 },
    { name: "jumps", initial: 0 },
  ],
  rules: [
    rule("arm", input("jump"), [
      { type: "set_variable", name: "armed", value: 1 },
      { type: "add_variable", name: "jumps", amount: 1 },
    ]),
    rule(
      "gated",
      input("up"),
      [{ type: "add_score", amount: 7 }],
      [variable("armed", 1), variable("jumps", 1)],
    ),
    rule("click", { type: "click", entityId: "target" }, [
      { type: "add_score", amount: 3 },
      { type: "set_color", entityId: "target", color: "#0000ff" },
    ]),
    rule("hide", input("left"), [
      { type: "set_visibility", entityId: "target", visible: false },
    ]),
    rule("show", input("down"), [
      { type: "set_visibility", entityId: "target", visible: true },
      { type: "set_position", entityId: "target", position: [-3, 0, 0] },
    ]),
    rule("path", input("right"), [
      {
        type: "move_path",
        entityId: "target",
        points: [
          [-3, 0, 0],
          [3, 0, 0],
        ],
        duration: 1,
        loop: false,
      },
    ]),
  ],
};
const commands = [
  {
    type: "reserve_entity",
    entity: {
      id: "target",
      label: "Clickable cube",
      position: [0, 0, 0],
      color: "#ff00ff",
      stage: "seed",
    },
  },
  {
    type: "set_geometry",
    id: "target",
    geometry: {
      kind: "custom",
      detail: "refined",
      parts: [
        {
          shape: "box",
          position: [0, 0.65, 0],
          scale: [1.3, 1.3, 1.3],
          color: "#ff00ff",
        },
      ],
    },
  },
  { type: "set_game", game },
  { type: "commit_revision", message: "Action game ready." },
];
const report = {
  passed: false,
  realProviderCalls: 0,
  editor: {},
  standalone: {},
  pageErrors: [],
  externalStandaloneRequests: [],
};
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let page, player, server;
// Locate the actual rendered colored object. No store, React internals or test hooks.
async function coloredCenter(page, color, editor) {
  const { data, info } = await sharp(await page.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0,
    xsum = 0,
    ysum = 0;
  for (let y = 180; y < info.height - 130; y++)
    for (let x = editor ? 380 : 150; x < info.width - 100; x++) {
      const offset = (y * info.width + x) * 4;
      const [r, g, b] = data.subarray(offset, offset + 3);
      const matches =
        color === "pink"
          ? r > 160 && b > 130 && g < 130
          : b > 145 && r < 115 && g < 145;
      if (matches) {
        count++;
        xsum += x;
        ysum += y;
      }
    }
  return count > 50
    ? { x: xsum / count, y: ysum / count, pixels: count }
    : null;
}
async function center(page, color, editor) {
  let found;
  await expect
    .poll(
      async () => {
        found = await coloredCenter(page, color, editor);
        return !!found;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  return found;
}
async function exercise(page, editor, result) {
  const score = page.locator(editor ? ".game-hud strong" : ".score");
  const expected = (value) => (editor ? String(value) : `Score: ${value}`);
  const tap = (key) => page.keyboard.press(key, { delay: 100 });
  await expect(score).toHaveText(expected(0));
  const initial = await center(page, "pink", editor);
  // A focused button owns Space activation. Click the ground to give gameplay
  // keyboard focus before exercising the jump-triggered variable rule.
  await page.mouse.click(1080, 650);
  await tap("w");
  await expect(score).toHaveText(expected(0));
  await tap(" ");
  await tap("w");
  await expect(score).toHaveText(expected(7));
  result.variableConditions = true;
  await page.mouse.click(initial.x, initial.y);
  await expect(score).toHaveText(expected(10));
  const blue = await center(page, "blue", editor);
  result.clickAndColor = true;
  await tap("a");
  await expect.poll(() => coloredCenter(page, "blue", editor)).toBeNull();
  await page.mouse.click(blue.x, blue.y);
  await expect(score).toHaveText(expected(10));
  result.hiddenNotClickable = true;
  await tap("s");
  const moved = await center(page, "blue", editor);
  expect(Math.abs(moved.x - blue.x)).toBeGreaterThan(50);
  await page.mouse.click(moved.x, moved.y);
  await expect(score).toHaveText(expected(13));
  result.setPositionVisible = true;
  await tap("d");
  let end;
  await expect
    .poll(
      async () => {
        end = await coloredCenter(page, "blue", editor);
        return end ? end.x - moved.x : 0;
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(140);
  // Wait for the path endpoint rather than click a moving centroid.
  let previous = end.x;
  await expect
    .poll(
      async () => {
        const next = await coloredCenter(page, "blue", editor);
        const stable = next && Math.abs(next.x - previous) < 1;
        previous = next?.x ?? previous;
        end = next;
        return stable;
      },
      { timeout: 15000, intervals: [200] },
    )
    .toBe(true);
  await page.mouse.click(end.x, end.y);
  await expect(score).toHaveText(expected(16));
  result.pathMovesVisibleObject = true;
  await tap(" ");
  await tap("w");
  await expect(score).toHaveText(expected(16));
  result.changedVariableClosesGate = true;
  await page.screenshot({
    path: `${dir}/${editor ? "editor" : "standalone"}-actions.png`,
  });
  await page
    .getByRole("button", {
      name: editor ? "Restart game" : /Restart/,
      exact: editor,
    })
    .click();
  await expect(score).toHaveText(expected(0));
  await center(page, "pink", editor);
  await tap("w");
  await expect(score).toHaveText(expected(0));
  result.restartRestoresColorAndVariables = true;
}
try {
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3 } });
    if (path === "/api/generate")
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
      });
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(process.env.TEST_URL ?? "http://127.0.0.1:3024");
  await page
    .locator("#prompt")
    .fill(
      "Create an interactive cube with variable gates, color and movement actions.",
    );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Action game ready.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await exercise(page, true, report.editor);
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  await (await download).saveAs(dir + "/world.zip");
  const files = unzipSync(await readFile(dir + "/world.zip"));
  expect(JSON.parse(strFromU8(files["project.json"])).game).toEqual(game);
  server = createServer((req, res) => {
    const path =
      new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    const bytes = files[path];
    if (!bytes) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        js: "text/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
      }[path.split(".").pop()] ?? "application/octet-stream",
    );
    res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  player = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  player.on("pageerror", (error) => report.pageErrors.push(error.message));
  player.on("request", (request) => {
    if (!request.url().startsWith(origin) && !request.url().startsWith("data:"))
      report.externalStandaloneRequests.push(request.url());
  });
  await player.goto(origin);
  await expect(player.locator("main[data-ready=true]")).toBeVisible();
  await expect(player.locator(".message")).toHaveCount(0);
  await exercise(player, false, report.standalone);
  expect(report.pageErrors).toEqual([]);
  expect(report.externalStandaloneRequests).toEqual([]);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  await (player ?? page)
    ?.screenshot({ path: dir + "/failure.png" })
    .catch(() => undefined);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await writeFile(dir + "/report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
