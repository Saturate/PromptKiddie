import "dotenv/config";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { serve } from "@hono/node-server";
import { loadConfig } from "@promptkiddie/core";

import engagements from "./routes/engagements.js";
import targets from "./routes/targets.js";
import findings from "./routes/findings.js";
import objectives from "./routes/objectives.js";
import artifacts from "./routes/artifacts.js";
import evidence from "./routes/evidence.js";
import activity from "./routes/activity.js";
import agents from "./routes/agents.js";
import messages from "./routes/messages.js";

const config = loadConfig();
const port = config.api.port;
const secret = config.api.secret;

const app = new Hono();

if (secret) {
  app.use("/*", bearerAuth({ token: secret }));
}

app.route("/engagements", engagements);

// Nested engagement routes (targets, findings, etc.) handle their own /engagements/:id/xxx prefix
app.route("/", targets);
app.route("/", findings);
app.route("/", objectives);
app.route("/", artifacts);
app.route("/", evidence);
app.route("/", activity);
app.route("/", agents);

// Messages are top-level
app.route("/", messages);

serve({ fetch: app.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
});
