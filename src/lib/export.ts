import {
  zipSync,
  strToU8,
  compressSync,
  decompressSync,
  strFromU8,
} from "fflate";
import { committed, projectSchema, type Project } from "./protocol";
export function encodeWorld(project: Project) {
  const p = { ...committed(project), messages: [] };
  return btoa(String.fromCharCode(...compressSync(strToU8(JSON.stringify(p)))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function decodeWorld(encoded: string) {
  if (encoded.length > 50000) throw Error("World link is too large.");
  const bytes = Uint8Array.from(
    atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  const result = decompressSync(bytes, { out: new Uint8Array(1000000) });
  if (result.length > 1000000) throw Error("World is too large.");
  return projectSchema.parse(JSON.parse(strFromU8(result)));
}
export function shareWorld(project: Project) {
  return `${location.origin}/#orb=${encodeWorld(project)}`;
}
export function playerHTML(title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/[<>&"']/g, "")} — Orbsie</title><link rel="stylesheet" href="runtime.css"></head><body><div id="root"></div><script type="module" src="runtime.js"></script></body></html>`;
}
export async function exportWorld(project: Project) {
  const [js, css, source] = await Promise.all([
    fetch("/player/runtime.js"),
    fetch("/player/runtime.css"),
    fetch("/player/source.json"),
  ]);
  if (!js.ok || !css.ok || !source.ok)
    throw Error(
      "The standalone runtime is not ready. Please try again after deployment.",
    );
  const files: Record<string, Uint8Array> = {
    "index.html": strToU8(playerHTML(project.title)),
    "project.json": strToU8(
      JSON.stringify({ ...committed(project), messages: [] }, null, 2),
    ),
    "runtime.js": new Uint8Array(await js.arrayBuffer()),
    "runtime.css": strToU8(await css.text()),
    "package.json": strToU8(
      JSON.stringify(
        {
          name: "my-orbsie-world",
          version: "1.0.0",
          private: true,
          type: "module",
          license: "Apache-2.0",
          scripts: {
            dev: "vite --host 0.0.0.0",
            build: "node build.mjs",
            preview: "vite preview",
            "build:source": "node build-source.mjs",
          },
          dependencies: {
            react: "19.2.8",
            "react-dom": "19.2.8",
            three: "0.185.1",
            "@react-three/fiber": "9.7.0",
            "@react-three/drei": "10.7.8",
            zustand: "5.0.15",
            zod: "4.5.4",
            "idb-keyval": "6.3.0",
          },
          devDependencies: { vite: "8.2.2", esbuild: "0.28.2" },
        },
        null,
        2,
      ),
    ),
    "README.md": strToU8(
      `# ${project.title}\n\nAn independent Orbsie world. No account, AI credentials, editor services, or API is required to play.\n\nRun npm install and npm run dev, or serve this directory with any static HTTP server. Use WASD/arrow keys and Space to jump; touch controls are included.\n\nThe pinned, bundled runtime.js and runtime.css work directly. Runtime source is included under src. To rebuild from source: npm run build:source. Project content is project.json.\n\nThe Orbsie runtime is Apache-2.0 licensed. Original creator retains their project content rights.\n`,
    ),
  };
  files["build.mjs"] = strToU8(
    "import {execFileSync} from 'node:child_process';import {copyFileSync} from 'node:fs';execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit'});copyFileSync('project.json','dist/project.json');",
  );
  const sources = (await source.json()) as Record<string, string>;
  for (const [path, text] of Object.entries(sources))
    files[path] = strToU8(text);
  const data = zipSync(files, { level: 6 });
  const blob = new Blob([new Uint8Array(data)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orbsie-${project.id.slice(0, 8)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
