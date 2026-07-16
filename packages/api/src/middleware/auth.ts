import type { Context, Next } from "hono";

export interface KeyIdentity {
  role: string;
  instance: string;
  raw: string;
}

const keyMap = new Map<string, KeyIdentity>();

export function initKeys(envVar?: string) {
  if (!envVar) return;
  for (const entry of envVar.split(",")) {
    const [identity, key] = entry.split("=");
    if (!identity || !key) continue;
    const [role, instance] = identity.includes(":")
      ? [identity.split(":")[0], identity.split(":").slice(1).join(":")]
      : [identity, "default"];
    keyMap.set(key.trim(), { role, instance, raw: identity.trim() });
  }
}

export function resolveKey(token: string): KeyIdentity | null {
  return keyMap.get(token) ?? null;
}

export function authMiddleware(legacySecret?: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      if (keyMap.size === 0 && !legacySecret) {
        c.set("keyIdentity", { role: "anonymous", instance: "local", raw: "anonymous:local" } satisfies KeyIdentity);
        return next();
      }
      return c.json({ error: "unauthorized" }, 401);
    }

    const token = header.slice(7);

    const identity = resolveKey(token);
    if (identity) {
      c.set("keyIdentity", identity);
      return next();
    }

    if (legacySecret && token === legacySecret) {
      c.set("keyIdentity", { role: "legacy", instance: "shared", raw: "legacy:shared" } satisfies KeyIdentity);
      return next();
    }

    return c.json({ error: "invalid api key" }, 401);
  };
}
