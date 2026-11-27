// Builds dist/kimi-game.js (ESM, three.js left to the page's import map), a minified copy,
// and one self-contained page per example in dist/play/ (three.js and the engine inlined).
import * as esbuild from "esbuild";
import { readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const banner = `/* kimi/game ${pkg.version} — Apache-2.0 — https://github.com/kiplabat/kimi-game. Built on three.js (MIT). */`;

// only the bare "three" import stays external; the post-processing addons are bundled in,
// because KimiLM serves three.js itself but not every addon.
const threeExternal = {
  name: "three-external",
  setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: "three", external: true })); },
};
const common = { entryPoints: [join(root, "src/index.ts")], bundle: true, format: "esm", target: "es2022", banner: { js: banner }, plugins: [threeExternal], logLevel: "warning" };
await esbuild.build({ ...common, outfile: join(root, "dist/kimi-game.js") });
await esbuild.build({ ...common, outfile: join(root, "dist/kimi-game.min.js"), minify: true });

// examples → single files
const kimiAlias = { name: "kimi-alias", setup(b) { b.onResolve({ filter: /^kimi\/game$/ }, () => ({ path: join(root, "src/index.ts") })); } };
mkdirSync(join(root, "dist/play"), { recursive: true });
for (const name of readdirSync(join(root, "examples"))) {
  const entry = join(root, "examples", name, "game.js");
  if (!existsSync(entry)) continue;
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", target: "es2022", minify: true, write: false, plugins: [kimiAlias], logLevel: "warning" });
  const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const title = (readFileSync(entry, "utf8").match(/title: "([^"]+)"/) ?? [, name])[1];
  writeFileSync(join(root, "dist/play", name + ".html"),
    `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">` +
    `<title>${title}</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style></head>` +
    `<body><script type="module">${banner}\n${js}</script></body></html>\n`);
  console.log("dist/play/" + name + ".html", (js.length / 1024).toFixed(0) + " KB");
}
// full games (games/<name>/src/main.js) → dist/play/<name>.html, plus games/<name>/build/ (index.html + game.js)
// for the desktop app and the KimiLM app, all offline: three.js, its addons and the engine are bundled in.
if (existsSync(join(root, "games"))) {
  for (const name of readdirSync(join(root, "games"))) {
    const entry = join(root, "games", name, "src", "main.js");
    if (!existsSync(entry)) continue;
    const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", target: "es2022", minify: true, write: false, plugins: [kimiAlias], logLevel: "warning", legalComments: "none" });
    const js = out.outputFiles[0].text;
    const title = (readFileSync(entry, "utf8").match(/title: "([^"]+)"/) ?? [, name])[1];
    const head = `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">` +
      `<title>${title}</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style></head><body>`;
    writeFileSync(join(root, "dist/play", name + ".html"), `${head}<script type="module">${banner}\n${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>\n`);
    const bdir = join(root, "games", name, "build");
    mkdirSync(bdir, { recursive: true });
    writeFileSync(join(bdir, "game.js"), banner + "\n" + js);
    writeFileSync(join(bdir, "index.html"), `${head}<script type="module" src="./game.js"></script></body></html>\n`);
    console.log("dist/play/" + name + ".html", (js.length / 1024).toFixed(0) + " KB");
    // for KimiLM's Games: three.js and kimi/game come from KimiLM's import map (the engine it vendors)
    const ext = { name: "kimilm-externals", setup(b) { b.onResolve({ filter: /^(three|kimi\/game)$/ }, (a) => ({ path: a.path, external: true })); } };
    const k = await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", target: "es2022", minify: true, write: false, plugins: [ext], logLevel: "warning", legalComments: "none" });
    const kdir = join(bdir, "kimilm");
    mkdirSync(kdir, { recursive: true });
    writeFileSync(join(kdir, "game.js"), banner + "\n" + k.outputFiles[0].text);
    writeFileSync(join(kdir, "index.html"), `${head}<script type="module" src="./game.js"></script></body></html>\n`);
    console.log("games/" + name + "/build/kimilm/game.js", (k.outputFiles[0].text.length / 1024).toFixed(0) + " KB (three.js and kimi/game from KimiLM)");
  }
}
for (const f of ["kimi-game.js", "kimi-game.min.js"]) console.log("dist/" + f, (readFileSync(join(root, "dist", f)).length / 1024).toFixed(0) + " KB");
