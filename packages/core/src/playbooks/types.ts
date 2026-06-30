import type { PlaybookStep } from "../schema.js";

export interface PlaybookPhaseTemplate {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

export type PlaybookPhase = PlaybookPhaseTemplate;

export interface PlaybookDef {
  name: string;
  description: string;
  phases: PlaybookPhaseTemplate[];
}
