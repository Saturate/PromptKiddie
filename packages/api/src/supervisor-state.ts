interface SupervisorState {
  running: boolean;
  activeCount: number;
  activeEngagements: string[];
}

let state: SupervisorState = { running: false, activeCount: 0, activeEngagements: [] };

export function setSupervisorState(s: SupervisorState) { state = s; }
export function getSupervisorState(): SupervisorState { return state; }
