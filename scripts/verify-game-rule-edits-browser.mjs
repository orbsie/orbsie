import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const directory = "docs/evidence/game-rule-edits";
await mkdir(directory, { recursive: true });
const base = process.env.TEST_URL ?? "http://127.0.0.1:3024";
const program = (amount) => ({
  variables: [],
  rules: [
    {
      id: "right",
      trigger: { type: "input", action: "right" },
      conditions: [],
      actions: [{ type: "add_score", amount }],
    },
  ],
});
const responses = [
  [
    {
      type: "reserve_entity",
      entity: { id: "tree", label: "Tree", position: [0, 0, 0], stage: "seed" },
    },
    {
      type: "set_geometry",
      id: "tree",
      geometry: { kind: "tree", detail: "refined" },
    },
    { type: "set_game", game: program(1) },
    { type: "commit_revision", message: "Game created." },
  ],
  [
    { type: "set_material", id: "tree", color: "#ff44aa" },
    { type: "commit_revision", message: "Tree recolored." },
  ],
  [
    { type: "set_game", game: program(5) },
    { type: "commit_revision", message: "Rules updated." },
  ],
];
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let page;
const report = {
  passed: false,
  realProviderCalls: 0,
  fixtureRequests: 0,
  materialPreservesScore: false,
  changedRulesResetScore: false,
  resetNoticeVisible: false,
  replacementRuleWorks: false,
  pageErrors: [],
};
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
    if (path === "/api/generate") {
      const commands = responses[report.fixtureRequests++];
      if (!commands)
        return route.fulfill({
          status: 500,
          json: { error: "Unexpected fixture request." },
        });
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(base);
  await page.locator("#prompt").fill("Create an input game with one tree.");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Game created.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.keyboard.press("d", { delay: 100 });
  await expect(page.locator(".game-hud strong")).toHaveText("1");
  await page.keyboard.press("d", { delay: 100 });
  await expect(page.locator(".game-hud strong")).toHaveText("2");
  await page
    .locator("#prompt")
    .fill("Recolor the tree pink and preserve all rules.");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByText("Tree recolored.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".game-hud strong")).toHaveText("2");
  report.materialPreservesScore = true;
  await page
    .locator("#prompt")
    .fill("Change the right input to add five points.");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(page.getByText("Rules updated.", { exact: true })).toBeVisible();
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  report.changedRulesResetScore = true;
  await expect(page.getByRole("status")).toContainText(
    "Rules changed. Play restarted",
  );
  report.resetNoticeVisible = true;
  await page.keyboard.press("d", { delay: 100 });
  await expect(page.locator(".game-hud strong")).toHaveText("5");
  report.replacementRuleWorks = true;
  expect(report.fixtureRequests).toBe(3);
  expect(report.pageErrors).toEqual([]);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await page
    ?.screenshot({ path: directory + "/rule-edit.png" })
    .catch(() => undefined);
  await browser.close();
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
