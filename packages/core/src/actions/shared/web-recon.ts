import type { RunContext } from "../../sdk.js";

export async function webFingerprint(ctx: RunContext, port: number) {
  const result = await ctx.exec("whatweb", [`http://${ctx.target}:${port}`, "--log-json=-"], { stream: true });
  if (result.code !== 0) {
    await ctx.discover("negative", "web", `whatweb failed on port ${port}: exit ${result.code}`);
    // Fallback: extract versions from HTTP headers directly
    await headerVersions(ctx, port);
    return;
  }
  try {
    const entries = JSON.parse(`[${result.stdout.trim().split("\n").join(",")}]`) as Array<Record<string, unknown>>;
    for (const entry of entries) {
      const plugins = entry.plugins as Record<string, unknown> | undefined;
      if (!plugins) continue;
      for (const [name, info] of Object.entries(plugins)) {
        const versions = (info as Record<string, unknown>)?.version as string[] | undefined;
        if (versions?.length) {
          await ctx.emit("VersionIdentified", { product: name, version: versions[0], source: "whatweb", port });
        }
      }
    }
  } catch {
    await ctx.discover("positive", "web", `whatweb raw output on port ${port}`, { raw: result.stdout.slice(0, 2000) });
    await headerVersions(ctx, port);
  }
}

async function headerVersions(ctx: RunContext, port: number) {
  const result = await ctx.exec("curl", ["-sI", `http://${ctx.target}:${port}`]);
  const headers = result.stdout;

  const server = headers.match(/^Server:\s*(.+)$/mi);
  if (server) {
    const m = server[1].trim().match(/^(\S+)\/([\d.]+)/);
    if (m) {
      await ctx.emit("VersionIdentified", { product: m[1], version: m[2], source: "http_header", port });
    }
  }

  const powered = headers.match(/^X-Powered-By:\s*(.+)$/mi);
  if (powered) {
    const m = powered[1].trim().match(/^(\S+)\/([\d.]+)/);
    if (m) {
      await ctx.emit("VersionIdentified", { product: m[1], version: m[2], source: "http_header", port });
    }
  }
}

export async function wafDetect(ctx: RunContext, port: number) {
  const result = await ctx.exec("wafw00f", [`http://${ctx.target}:${port}`]);
  if (result.stdout.includes("is behind")) {
    const match = result.stdout.match(/is behind\s+(.+)/);
    if (match) {
      await ctx.discover("positive", "waf", `WAF detected on port ${port}: ${match[1].trim()}`);
    }
  }
}

export async function headerInspect(ctx: RunContext, port: number) {
  const result = await ctx.exec("curl", ["-sI", `http://${ctx.target}:${port}`]);
  const headers = result.stdout;
  const redirect = headers.match(/^Location:\s*(.+)$/mi);
  if (redirect) {
    const url = redirect[1].trim();
    const hostMatch = url.match(/https?:\/\/([^/:]+)/);
    if (hostMatch && hostMatch[1] !== ctx.target) {
      await ctx.emit("HostnameFound", { hostname: hostMatch[1], source: "http_redirect", port });
    }
  }
}
