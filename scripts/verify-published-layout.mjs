/** Actual server component and stylesheet; synthetic database and iframe content. */
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-published-layout-"));
const directory = "docs/evidence/published-layout";
let browser;
try {
  const thumbnail =
    "data:image/png;base64," +
    (
      await readFile(
        "docs/evidence/formation-continuity/publication-thumbnail.png",
      )
    ).toString("base64");
  const row = {
    public_url: "https://fixture.orbsie.test/game",
    published_revision: 3,
    published_metadata: {
      revision: 3,
      title:
        "A very long wonderful island adventure with glowing crystals and friendly trees",
      creator: "A creator with a long public display name",
      thumbnail,
    },
  };
  await build({
    entryPoints: ["src/app/o/[id]/page.tsx"],
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporary, "page.mjs"),
    define: { "process.env.DATABASE_URL": '"fixture"' },
    plugins: [
      {
        name: "fixture-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /lib\/server\/auth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          builder.onResolve(
            { filter: /^next\/(link|navigation)$/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          builder.onResolve({ filter: /^react(\/.*)?$/ }, (args) => ({
            path: resolve(
              "node_modules",
              args.path === "react"
                ? "react/index.js"
                : args.path === "react/jsx-runtime"
                  ? "react/jsx-runtime.js"
                  : args.path,
            ),
            external: true,
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents:
              args.path === "auth"
                ? `export const database=()=>({query:async()=>({rows:[${JSON.stringify(row)}]})});`
                : args.path === "next/navigation"
                  ? 'export function notFound(){throw Error("not found");}'
                  : 'import React from "react"; export default function Link(props){return React.createElement("a",props);}',
            loader: "js",
          }));
        },
      },
    ],
  });
  const { default: Page } = await import(
    pathToFileURL(join(temporary, "page.mjs"))
  );
  const markup = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ id: "fixture" }) }),
  );
  const css = (await readFile("src/app/globals.css", "utf8")).replace(
    /^@import[^\n]*\n/,
    "",
  );
  browser = await chromium.launch({ args: ["--no-sandbox"] });
  await mkdir(directory, { recursive: true });
  const report = {
    scope:
      "Actual sharing component/CSS with synthetic database and iframe; no publication or inference",
    results: [],
  };
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: route.request().url().endsWith("/game")
          ? '<body style="background:#18372d;color:white">Game fixture</body>'
          : `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>${markup}`,
      }),
    );
    await page.goto("https://fixture.orbsie.test/");
    const bounds = await page.evaluate(() => {
      const header = document
        .querySelector(".published-orb > header")
        .getBoundingClientRect();
      const action = document
        .querySelector(".published-orb > header .primary")
        .getBoundingClientRect();
      const identity = document
        .querySelector(".published-identity")
        .getBoundingClientRect();
      const image = document.querySelector(".published-thumbnail");
      return {
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        headerHeight: header.height,
        headerBottom: header.bottom,
        identityBottom: identity.bottom,
        actionLeft: action.left,
        actionRight: action.right,
        identityRight: identity.right,
        imageLoaded: image.complete && image.naturalWidth > 0,
      };
    });
    await page.screenshot({ path: join(directory, `${viewport.width}.png`) });
    assert.ok(bounds.scrollWidth <= viewport.width, "Horizontal overflow");
    assert.ok(bounds.actionRight <= viewport.width, "Action outside viewport");
    assert.ok(
      bounds.identityRight <= bounds.actionLeft,
      "Identity overlaps action",
    );
    assert.ok(bounds.imageLoaded, "Preview missing");
    assert.ok(
      bounds.identityBottom <= bounds.headerBottom,
      "Metadata clipped below header",
    );
    report.results.push({ viewport, bounds });
    await page.close();
  }
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify({ ...report, status: "passed" }, null, 2) + "\n",
  );
  console.log("Desktop/mobile sharing layout checks passed.");
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
