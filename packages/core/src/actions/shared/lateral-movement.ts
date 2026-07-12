import type { RunContext } from "../../sdk.js";

/** Enumerate current user context: groups, network, processes, keys. */
export async function enumerateContext(ctx: RunContext) {
  const [id, groups, ssh, netConns, procs] = await Promise.all([
    ctx.exec("id", []),
    ctx.exec("groups", []),
    ctx.exec("find", ["/home", "-path", "*/.ssh/*", "-type", "f"]),
    ctx.exec("ss", ["-tlnp"]),
    ctx.exec("ps", ["aux"]),
  ]);

  await ctx.discover("positive", "lateral", "User context enumerated", {
    id: id.stdout.trim(),
    groups: groups.stdout.trim(),
    sshFiles: ssh.stdout.trim().split("\n").filter(Boolean),
    listeners: netConns.stdout.slice(0, 2000),
    processes: procs.stdout.slice(0, 2000),
  });

  return {
    id: id.stdout.trim(),
    groups: groups.stdout.trim(),
    sshFiles: ssh.stdout.trim().split("\n").filter(Boolean),
  };
}

/** Identify trust boundaries: shared credentials, writable scripts, group-based access. */
export async function identifyBoundary(ctx: RunContext) {
  const [cron, writableScripts, dbConfigs, sudoL] = await Promise.all([
    ctx.exec("cat", ["/etc/crontab"]),
    ctx.exec("find", ["/", "-writable", "-name", "*.sh", "-type", "f"]),
    ctx.exec("find", ["/", "-maxdepth", "4", "-name", "*.conf", "-path", "*/mysql/*", "-o", "-name", "*.conf", "-path", "*/postgres/*"]),
    ctx.exec("sudo", ["-l"]),
  ]);

  const vectors: string[] = [];

  if (cron.code === 0 && cron.stdout.trim()) {
    vectors.push("cron jobs");
    await ctx.discover("positive", "lateral", "Cron jobs found", { raw: cron.stdout.slice(0, 1000) });
  }
  if (writableScripts.stdout.trim()) {
    vectors.push("writable scripts");
    await ctx.discover("positive", "lateral", "Writable scripts found", {
      files: writableScripts.stdout.trim().split("\n").slice(0, 20),
    });
  }
  if (dbConfigs.stdout.trim()) {
    vectors.push("database configs");
  }
  if (sudoL.code === 0 && sudoL.stdout.includes("NOPASSWD")) {
    vectors.push("sudo NOPASSWD");
    await ctx.discover("positive", "lateral", "sudo NOPASSWD entries found", {
      raw: sudoL.stdout.slice(0, 1000),
    });
  }

  return vectors;
}

/** Exploit a trust boundary crossing and verify access. Delegates to LLM for judgment. */
export async function exploitBoundary(ctx: RunContext) {
  const analysis = await ctx.spawnLlm(
    "Identify and exploit the best trust boundary crossing.\n" +
    "Look for:\n" +
    "- SSH keys that authenticate as another user\n" +
    "- Writable cron jobs or scripts run by another user\n" +
    "- sudo entries allowing command execution as another user\n" +
    "- Database access that exposes credentials for other services\n" +
    "- Group memberships granting access to restricted files\n\n" +
    "Execute the crossing, verify access with `id` and `whoami`, and report the result.\n" +
    `Target: ${ctx.target}`,
    { agentType: "exploit-agent", priority: 5 },
  );

  ctx.log(`Lateral movement analysis: ${analysis.slice(0, 200)}`);
}

/** Run the full lateral movement workflow. */
export async function lateralMovement(ctx: RunContext) {
  await enumerateContext(ctx);
  const vectors = await identifyBoundary(ctx);

  if (vectors.length === 0) {
    await ctx.discover("negative", "lateral", "No obvious trust boundary crossings found");
    return;
  }

  ctx.log(`Lateral movement vectors: ${vectors.join(", ")}`);
  await exploitBoundary(ctx);
}
