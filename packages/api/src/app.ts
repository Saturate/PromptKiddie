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
import services from "./routes/services.js";
import ports from "./routes/ports.js";
import webshells from "./routes/webshells.js";
import events from "./routes/events.js";
import discoveries from "./routes/discoveries.js";
import execDedup from "./routes/exec-dedup.js";
import knowledge from "./routes/knowledge.js";
import settings from "./routes/settings.js";
import playbookActions from "./routes/playbook-actions.js";
import status from "./routes/status.js";

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
  app.route("/", services);
  app.route("/", ports);
  app.route("/", webshells);
  app.route("/", events);
  app.route("/", discoveries);
  app.route("/", execDedup);
  app.route("/", knowledge);
  app.route("/", settings);
  app.route("/", playbookActions);
  app.route("/", status);

  app.get("/health", (c) => c.json({ ok: true }));

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}
