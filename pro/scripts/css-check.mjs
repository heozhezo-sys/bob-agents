#!/usr/bin/env node
/**
 * Guards against a stylesheet that silently loses every rule after a break:
 * an unclosed rule makes the browser drop the rest of the file, which a type
 * check cannot see. This checks brace balance only.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STYLESHEETS = ["client/src/styles.css"];

let failures = 0;

for (const relative of STYLESHEETS) {
  const source = await readFile(path.join(ROOT, relative), "utf8");
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

  let depth = 0;
  let line = 1;
  let extraAt = 0;
  for (const char of stripped) {
    if (char === "\n") line += 1;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        extraAt = line;
        break;
      }
    }
  }

  if (depth !== 0 || extraAt > 0) {
    failures += 1;
    const detail = extraAt > 0 ? `unexpected } near line ${extraAt}` : `${depth} unclosed {`;
    console.error(`  FAIL  ${relative} has unbalanced braces — ${detail}`);
  } else {
    console.log(`  PASS  ${relative} has balanced braces`);
  }
}

if (failures > 0) {
  console.error(`${failures} stylesheet check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All stylesheet checks passed.");
}
