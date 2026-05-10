#!/usr/bin/env node
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));
const errors = [];
if (server.version !== pkg.version) errors.push(`server.json version ${server.version} != package.json ${pkg.version}`);
const npmPkg = server.packages?.[0];
if (!npmPkg) errors.push("server.json missing packages[0]");
else {
  if (npmPkg.identifier !== pkg.name) errors.push(`identifier ${npmPkg.identifier} != ${pkg.name}`);
  if (npmPkg.version !== pkg.version) errors.push(`pkg version ${npmPkg.version} != ${pkg.version}`);
}
if (errors.length > 0) {
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, package: pkg.name, version: pkg.version }, null, 2));
