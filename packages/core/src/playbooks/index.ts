export type { PlaybookPhaseTemplate, PlaybookPhase, PlaybookDef } from "./types.js";
export { CTF_PLAYBOOK } from "./ctf.js";

import type { PlaybookDef } from "./types.js";
import { CTF_PLAYBOOK } from "./ctf.js";

export const DEFAULT_PLAYBOOKS: Record<string, PlaybookDef> = {
  ctf: CTF_PLAYBOOK,
};
