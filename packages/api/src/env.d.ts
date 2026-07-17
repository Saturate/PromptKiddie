import type { KeyIdentity } from "./middleware/auth.js";

declare module "hono" {
  interface ContextVariableMap {
    keyIdentity: KeyIdentity;
  }
}
