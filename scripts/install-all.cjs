const { spawnSync } = require("node:child_process");
const path = require("node:path");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const component of ["api", "web", "simulator", "contracts"]) {
  const result = spawnSync(npm, ["ci"], { cwd: path.join(__dirname, "..", component), stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
