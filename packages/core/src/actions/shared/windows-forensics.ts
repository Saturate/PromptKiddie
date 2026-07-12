import type { RunContext } from "../../sdk.js";

/** Download and parse ntuser.dat from user profiles. */
export async function collectNtuser(ctx: RunContext) {
  const users = await ctx.exec("dir", ["C:\\Users", "/b"]);
  if (users.code !== 0) return;

  for (const user of users.stdout.trim().split("\n").filter(Boolean)) {
    const trimmed = user.trim();
    if (["Public", "Default", "Default User", "All Users"].includes(trimmed)) continue;
    const path = `C:\\Users\\${trimmed}\\NTUSER.DAT`;
    const check = await ctx.exec("dir", [path]);
    if (check.code === 0) {
      await ctx.discover("positive", "forensics", `NTUSER.DAT found for ${trimmed}`, { path });
    }
  }
}

/** Collect SAM, SECURITY, SYSTEM registry hives (requires SYSTEM-level access). */
export async function collectRegistryHives(ctx: RunContext) {
  const hives = ["SAM", "SECURITY", "SYSTEM"];
  for (const hive of hives) {
    const path = `C:\\Windows\\System32\\config\\${hive}`;
    const result = await ctx.exec("reg", ["save", `HKLM\\${hive}`, `C:\\temp\\${hive}.save`, "/y"]);
    if (result.code === 0) {
      await ctx.discover("positive", "forensics", `Registry hive saved: ${hive}`, { path });
    } else {
      await ctx.discover("negative", "forensics", `Cannot save ${hive} hive (insufficient privileges?)`);
    }
  }
}

/** Search for credential stores: KeePass, browser profiles, PuTTY, WinSCP, RDP files. */
export async function checkCredentialStores(ctx: RunContext) {
  const searches = [
    { name: "KeePass databases", ext: "*.kdbx", label: "keepass" },
    { name: "RDP files with saved creds", ext: "*.rdp", label: "rdp" },
  ];

  for (const s of searches) {
    const result = await ctx.exec("dir", ["/s", "/b", `C:\\Users\\${s.ext}`]);
    if (result.code === 0 && result.stdout.trim()) {
      await ctx.discover("positive", "credential", `${s.name} found`, {
        files: result.stdout.trim().split("\n").slice(0, 20),
      });
    }
  }

  // PuTTY saved sessions
  const putty = await ctx.exec("reg", [
    "query", "HKCU\\Software\\SimonTatham\\PuTTY\\Sessions", "/s",
  ]);
  if (putty.code === 0 && putty.stdout.trim()) {
    await ctx.discover("positive", "credential", "PuTTY saved sessions found", {
      raw: putty.stdout.slice(0, 2000),
    });
  }

  // PowerShell history
  const psHistory = await ctx.exec("dir", [
    "/s", "/b", "C:\\Users\\*\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt",
  ]);
  if (psHistory.code === 0 && psHistory.stdout.trim()) {
    await ctx.discover("positive", "forensics", "PowerShell history files found", {
      files: psHistory.stdout.trim().split("\n"),
    });
  }
}

/** Search for files with known sensitive content. */
export async function interestingFiles(ctx: RunContext) {
  const patterns = [
    { name: "unattend.xml", pattern: "unattend.xml" },
    { name: "sysprep.xml", pattern: "sysprep.xml" },
    { name: "web.config", pattern: "web.config" },
    { name: "appsettings.json", pattern: "appsettings.json" },
    { name: ".git directories", pattern: ".git" },
  ];

  for (const p of patterns) {
    const result = await ctx.exec("dir", ["/s", "/b", `C:\\${p.pattern}`]);
    if (result.code === 0 && result.stdout.trim()) {
      await ctx.discover("positive", "forensics", `${p.name} found`, {
        files: result.stdout.trim().split("\n").slice(0, 10),
      });
    }
  }
}

/** Run the full Windows forensics workflow. */
export async function windowsForensics(ctx: RunContext) {
  await collectNtuser(ctx);
  await collectRegistryHives(ctx);
  await checkCredentialStores(ctx);
  await interestingFiles(ctx);
}
