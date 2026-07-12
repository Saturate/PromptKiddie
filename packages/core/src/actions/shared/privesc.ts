import type { RunContext } from "../../sdk.js";

export async function linuxPrivesc(ctx: RunContext) {
  const [sudo, suid, cron, writable] = await Promise.all([
    ctx.exec("sudo", ["-l"]),
    ctx.exec("find", ["/", "-perm", "-4000", "-type", "f", "2>/dev/null"]),
    ctx.exec("cat", ["/etc/crontab"]),
    ctx.exec("find", ["/", "-writable", "-type", "f", "2>/dev/null"]),
  ]);

  if (sudo.code === 0 && sudo.stdout.trim()) {
    await ctx.discover("positive", "privesc", `sudo -l output found`, { raw: sudo.stdout.slice(0, 2000) });
  }
  if (suid.stdout.trim()) {
    await ctx.discover("positive", "privesc", `SUID binaries found`, { raw: suid.stdout.slice(0, 2000) });
  }
  if (cron.code === 0) {
    await ctx.discover("positive", "privesc", `crontab readable`, { raw: cron.stdout.slice(0, 2000) });
  }

  await ctx.spawnLlm(
    "Analyze these privilege escalation vectors and identify the best path:\n" +
    `sudo -l:\n${sudo.stdout.slice(0, 1000)}\n\n` +
    `SUID binaries:\n${suid.stdout.slice(0, 1000)}\n\n` +
    `Crontab:\n${cron.stdout.slice(0, 1000)}\n\n` +
    `Writable files:\n${writable.stdout.slice(0, 1000)}`
  );
}

export async function windowsPrivesc(ctx: RunContext) {
  const [whoami, services] = await Promise.all([
    ctx.exec("whoami", ["/priv"]),
    ctx.exec("sc", ["query", "state=", "all"]),
  ]);

  if (whoami.stdout.includes("SeImpersonate")) {
    await ctx.discover("positive", "privesc", "SeImpersonatePrivilege enabled");
  }
  if (whoami.stdout.includes("SeAssignPrimaryToken")) {
    await ctx.discover("positive", "privesc", "SeAssignPrimaryTokenPrivilege enabled");
  }

  await ctx.spawnLlm(
    "Analyze Windows privilege escalation vectors:\n" +
    `whoami /priv:\n${whoami.stdout.slice(0, 1000)}\n\n` +
    `Services:\n${services.stdout.slice(0, 1000)}`
  );
}
