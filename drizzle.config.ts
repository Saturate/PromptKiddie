import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/core/src/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie",
  },
  verbose: true,
  strict: true,
});
