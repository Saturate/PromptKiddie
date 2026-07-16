import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "@promptkiddie/core";
import { createApp } from "./app.js";
import { initKeys, authMiddleware } from "./middleware/auth.js";

const config = loadConfig();
const port = config.api.port;

initKeys(process.env.PK_API_KEYS);

const app = createApp();

app.use("/*", authMiddleware(config.api.secret ?? undefined));

serve({ fetch: app.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
});
