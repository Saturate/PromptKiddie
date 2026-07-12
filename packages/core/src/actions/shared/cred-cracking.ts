import type { RunContext } from "../../sdk.js";

export async function crackHashes(ctx: RunContext, hashFile: string) {
  const identify = await ctx.exec("hashid", ["-m", hashFile]);
  await ctx.discover("positive", "credential", `Hash type identified`, { raw: identify.stdout.slice(0, 500) });

  const john = await ctx.exec("john", ["--wordlist=/usr/share/wordlists/rockyou.txt", hashFile]);
  if (john.code === 0 && john.stdout.includes("cracked")) {
    const show = await ctx.exec("john", ["--show", hashFile]);
    await ctx.emit("CredentialFound", { source: "john", raw: show.stdout });
    await ctx.discover("positive", "credential", `Hashes cracked with john`, { raw: show.stdout.slice(0, 1000) });
  } else {
    await ctx.discover("negative", "credential", `john failed to crack hashes from ${hashFile}`);
  }
}

export async function passwordSpray(ctx: RunContext, userList: string, passwordList: string, service: string, port: number) {
  const result = await ctx.exec("hydra", [
    "-L", userList, "-P", passwordList,
    `${service}://${ctx.target}:${port}`,
  ], { timeout: 120000 });

  if (result.stdout.includes("host:")) {
    await ctx.emit("CredentialFound", { source: "hydra", service, raw: result.stdout });
  }
}
