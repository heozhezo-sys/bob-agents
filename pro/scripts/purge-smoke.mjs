#!/usr/bin/env node
/**
 * Deletes leftover smoke-test projects and any render directory whose project
 * no longer exists. The user's own projects are never touched: only names that
 * match a smoke-test pattern are removed.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4320";
const PASSWORD = process.env.APP_PASSWORD ?? "cutroom-dev";
const ROOT = path.resolve(import.meta.dirname, "..");
const RENDERS = path.join(ROOT, "data", "renders");
const SMOKE_NAMES = [/^UI upload /, /^Real footage smoke /, /^Render smoke$/, /^Leak probe$/];

const loginResponse = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: PASSWORD }),
});
if (!loginResponse.ok) throw new Error(`Login failed: ${loginResponse.status}`);
const cookie = (loginResponse.headers.getSetCookie?.() ?? [loginResponse.headers.get("set-cookie") ?? ""])
  .filter(Boolean)
  .map((value) => value.split(";")[0])
  .join("; ");
const csrf = (await loginResponse.json()).csrfToken;

const listResponse = await fetch(`${BASE}/api/projects`, { headers: { cookie } });
const { projects } = await listResponse.json();

let removed = 0;
for (const project of projects) {
  if (!SMOKE_NAMES.some((pattern) => pattern.test(project.name))) continue;
  const response = await fetch(`${BASE}/api/projects/${project.id}`, {
    method: "DELETE",
    headers: { cookie, "x-csrf-token": csrf },
  });
  console.log(`  ${response.status === 200 ? "removed" : "FAILED"}  ${project.name}`);
  removed += 1;
}
console.log(`\nRemoved ${removed} smoke project(s).`);

const live = new Set(projects.map((project) => project.id));
try {
  for (const entry of await readdir(RENDERS, { withFileTypes: true })) {
    if (!entry.isDirectory() || live.has(entry.name)) continue;
    await rm(path.join(RENDERS, entry.name), { recursive: true, force: true });
    console.log(`  removed  orphaned render directory ${entry.name}`);
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
