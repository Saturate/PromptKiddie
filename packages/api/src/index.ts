import "dotenv/config";
import { bearerAuth } from "hono/bearer-auth";
import { serve } from "@hono/node-server";
import { loadConfig } from "@promptkiddie/core";
import { createApp } from "./app.js";

const config = loadConfig();
const port = config.api.port;
const secret = config.api.secret;

const app = createApp();

if (secret) {
  app.use("/*", bearerAuth({ token: secret }));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
});
