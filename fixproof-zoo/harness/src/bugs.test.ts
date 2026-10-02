import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const sh = (cwd: string, cmd: string, args: string[]) => execFileSync(cmd, args, { cwd, stdio: "pipe" });

function tree(id: string, patches: string[]) {
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, ".tmp/bug-"));
  cpSync(join(root, "app/src/orders"), join(dir, "app/src/orders"), { recursive: true });
  mkdirSync(join(dir, "bugs", id), { recursive: true });
  cpSync(join(root, "bugs", id, "hidden.test.ts"), join(dir, "bugs", id, "hidden.test.ts"));
  writeFileSync(join(dir, "vitest.config.mjs"), 'export default { test: { include: ["bugs/**/*.test.ts"] } };');
  sh(dir, "git", ["init", "-q"]);
  for (const p of patches) sh(dir, "git", ["apply", join(root, "bugs", id, p)]);
  return dir;
}
function hiddenPasses(dir: string, id: string) {
  try {
    sh(dir, "node", [join(root, "node_modules/vitest/vitest.mjs"), "run", "--root", dir, `bugs/${id}/hidden.test.ts`]);
    return true;
  } catch {
    return false;
  }
}

describe.each([["S04", []], ["S05", ["bug.patch"]]] as const)("bug %s", (id, bug) => {
  it("hidden test fails when buggy and passes with fix.patch", () => {
    const buggy = tree(id, [...bug]);
    const fixed = tree(id, [...bug, "fix.patch"]);
    try {
      expect(hiddenPasses(buggy, id)).toBe(false);
      expect(hiddenPasses(fixed, id)).toBe(true);
    } finally {
      rmSync(buggy, { recursive: true, force: true });
      rmSync(fixed, { recursive: true, force: true });
    }
  });
  it("bug.patch re-applies cleanly after the fix", () => {
    const dir = tree(id, [...bug, "fix.patch", "bug.patch"]);
    try {
      expect(hiddenPasses(dir, id)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
