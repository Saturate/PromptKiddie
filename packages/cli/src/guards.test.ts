import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isSourceRepo, checkSourceRepo } from "./guards.js";

describe("isSourceRepo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pk-guard-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false for a directory without .pksource", () => {
    expect(isSourceRepo(tempDir)).toBe(false);
  });

  it("returns true when .pksource exists in the directory", () => {
    writeFileSync(join(tempDir, ".pksource"), "");
    expect(isSourceRepo(tempDir)).toBe(true);
  });

  it("returns true when .pksource exists in a parent directory", () => {
    writeFileSync(join(tempDir, ".pksource"), "");
    const child = join(tempDir, "packages", "cli", "src");
    const { mkdirSync } = require("node:fs");
    mkdirSync(child, { recursive: true });
    expect(isSourceRepo(child)).toBe(true);
  });

  it("returns false for the system root", () => {
    expect(isSourceRepo("/")).toBe(false);
  });
});

describe("checkSourceRepo", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pk-guard-test-"));
    writeFileSync(join(tempDir, ".pksource"), "");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns 'block' for exec command in source repo", () => {
    expect(checkSourceRepo(tempDir, "exec")).toBe("block");
  });

  it("returns 'warn' for finding add command in source repo", () => {
    expect(checkSourceRepo(tempDir, "finding add")).toBe("warn");
  });

  it("returns 'warn' for activity log command in source repo", () => {
    expect(checkSourceRepo(tempDir, "activity log")).toBe("warn");
  });

  it("returns 'ok' for any command outside source repo", () => {
    const other = mkdtempSync(join(tmpdir(), "pk-guard-other-"));
    try {
      expect(checkSourceRepo(other, "exec")).toBe("ok");
      expect(checkSourceRepo(other, "finding add")).toBe("ok");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
