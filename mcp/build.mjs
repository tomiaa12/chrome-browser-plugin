import * as esbuild from "esbuild";
import fs from "node:fs";

const outfile = "dist/server.cjs";
const pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

await esbuild.build({
  entryPoints: ["server.js"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile,
  logLevel: "info",
  define: {
    __MCP_PKG_VERSION__: JSON.stringify(pkgVersion),
  },
});

const code = fs.readFileSync(outfile, "utf8");
if (!code.startsWith("#!")) {
  fs.writeFileSync(outfile, `#!/usr/bin/env node\n${code}`);
}
try {
  fs.chmodSync(outfile, 0o755);
} catch {
  // Windows may ignore mode bits
}

console.log(`built ${outfile} (${fs.statSync(outfile).size} bytes)`);
