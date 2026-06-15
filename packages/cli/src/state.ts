/** Tiny local state: which engagement is "active" for this checkout (`pk engagement use`). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_DIR = join(process.cwd(), ".pk");
const STATE_FILE = join(STATE_DIR, "state.json");

interface State {
  activeEngagementId?: string;
}

async function read(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
  } catch {
    return {};
  }
}

async function write(state: State): Promise<void> {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export async function setActiveEngagement(id: string): Promise<void> {
  const state = await read();
  state.activeEngagementId = id;
  await write(state);
}

/** Resolve the engagement id: explicit flag > PK_ENGAGEMENT env > saved active state. */
export async function resolveEngagementId(flag?: string): Promise<string> {
  if (flag) return flag;
  if (process.env.PK_ENGAGEMENT) return process.env.PK_ENGAGEMENT;
  const state = await read();
  if (state.activeEngagementId) return state.activeEngagementId;
  throw new Error(
    "No active engagement. Use `pk engagement use <id>`, pass --engagement <id>, " +
      "or set PK_ENGAGEMENT.",
  );
}
