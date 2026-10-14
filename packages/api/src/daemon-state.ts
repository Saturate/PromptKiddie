interface DaemonState {
  running: boolean;
  activeCount: number;
  activeEngagements: string[];
}

let state: DaemonState = { running: false, activeCount: 0, activeEngagements: [] };

export function setDaemonState(s: DaemonState) { state = s; }
export function getDaemonState(): DaemonState { return state; }
