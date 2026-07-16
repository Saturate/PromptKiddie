import { Hono } from "hono";

import engagements from "./routes/engagements.js";
import targets from "./routes/targets.js";
import findings from "./routes/findings.js";
import objectives from "./routes/objectives.js";
import artifacts from "./routes/artifacts.js";
import evidence from "./routes/evidence.js";
import activity from "./routes/activity.js";
import agents from "./routes/agents.js";
import messages from "./routes/messages.js";

export function createApp() {
  const app = new Hono();

  app.route("/engagements", engagements);
  app.route("/", targets);
  app.route("/", findings);
  app.route("/", objectives);
  app.route("/", artifacts);
  app.route("/", evidence);
  app.route("/", activity);
  app.route("/", agents);
  app.route("/", messages);

  return app;
}
