export interface EngagementState {
  name: string
  id: string
  phase: string
  status: string
  findingCount: number
  serviceCount: number
  credCount: number
}

export interface EngagementEvent {
  id: string
  action: string
  phase: string
  timestamp: string
}

declare module 'claude-code' {
  interface PluginState {
    'pk-engage': {
      engagement: Shaped<EngagementState | null>
      events: Shaped<EngagementEvent[]>
      targets: Shaped<string[]>
    }
  }
}
