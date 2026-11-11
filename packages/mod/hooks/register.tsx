import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { EngagementState, EngagementEvent } from '../types'

const PANE = 'pk-engagement'

const engagement = atom(
  { plugin: 'pk-engage', key: 'engagement' } as const,
  null as EngagementState | null,
  { shape: 'eng-1' },
)
const events = atom(
  { plugin: 'pk-engage', key: 'events' } as const,
  [] as EngagementEvent[],
  { shape: 'events-1' },
)
const targets = atom(
  { plugin: 'pk-engage', key: 'targets' } as const,
  [] as string[],
  { shape: 'targets-1' },
)

async function refreshEngagement($: any): Promise<void> {
  try {
    const result = await $.process.run({
      command: ['pk', 'engagement', 'show', '--format', 'json'],
      timeout: 5000,
    })
    if (result.exitCode !== 0) return
    const data = JSON.parse(result.stdout)
    const eng = data.engagement
    if (!eng) return

    await update($, engagement, () => ({
      name: eng.name ?? '',
      id: eng.id ?? '',
      phase: eng.phase ?? 'recon',
      status: eng.status ?? 'active',
      findingCount: (data.findings ?? []).length,
      serviceCount: 0,
      credCount: 0,
    }))

    await update($, targets, () =>
      (data.targets ?? [])
        .filter((t: any) => t.inScope)
        .map((t: any) => t.identifier),
    )

    await update($, events, () =>
      (data.activity ?? []).slice(0, 20).map((a: any) => ({
        id: a.id ?? '',
        action: a.action ?? '',
        phase: a.phase ?? '',
        timestamp: a.createdAt ?? '',
      })),
    )
  } catch {
    // PK not running or no engagement active
  }
}

export const register: Register = on => {
  let refreshTimer: ReturnType<typeof setInterval> | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pk',
      description: 'Open the PK engagement dashboard pane',
    })

    await refreshEngagement($)

    // Poll every 10s for engagement state
    refreshTimer = setInterval(() => refreshEngagement($), 10_000)

    const eng = await read($, engagement)
    if (eng) {
      void $.ui.open({ id: PANE, title: `PK: ${eng.name}` })
    }

    return next(e)
  })

  on('command.run', { command: 'pk' }, async $ => {
    await refreshEngagement($)
    const eng = await read($, engagement)
    await $.ui.open({ id: PANE, title: eng ? `PK: ${eng.name}` : 'PK' })
    return { text: 'PK engagement pane opened.' }
  })

  // Status line: show engagement name + phase + finding count
  on('tool.call', async ($, e, next) => {
    const eng = await read($, engagement)
    if (eng) {
      $.ui.status(`PK: ${eng.name} | ${eng.phase} | ${eng.findingCount} findings`)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // Auto-route guard: block Bash commands targeting engagement IPs
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const tgts = await read($, targets)
    if (tgts.length === 0) return next(e)

    const cmd = (e as any).command ?? ''
    const isTargetCmd = tgts.some(ip => cmd.includes(ip))

    // Allow pk commands and local-only commands
    const isPkCmd = cmd.startsWith('pk ') || cmd.startsWith('htb ')
    const isLocalCmd = /^(git |npm |pnpm |yarn |docker |cd |ls |cat |grep |find |echo |which )/.test(cmd)

    if (isTargetCmd && !isPkCmd && !isLocalCmd) {
      return {
        deny: [
          `[PK] Direct target interaction blocked.`,
          `Use: pk exec -- ${cmd}`,
          `Or:  pk spawn agent --image pk-agent --role exploit --prompt "..."`,
          ``,
          `To disable: set pk_auto_route=warn in .claude/settings.local.json`,
        ].join('\n'),
      }
    }

    return next(e)
  }).catch((_$, e, next) => next(e))

  // Engagement dashboard pane
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const eng = await read($, engagement)
    const evts = await read($, events)
    const tgts = await read($, targets)

    if (!eng) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text dimColor>No active engagement.</Text>
          <Text dimColor>Run: pk engage {'<name>'} --target {'<ip>'}</Text>
        </Box>
      )
    }

    const room = Math.max(1, (e.viewport?.rows ?? 24) - 14)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>{eng.name}</Text>
        <Text dimColor>Phase: {eng.phase} | Status: {eng.status}</Text>
        <Text dimColor>ID: {eng.id.slice(0, 8)}</Text>
        <Text> </Text>

        <Text bold>Targets</Text>
        {tgts.length === 0
          ? <Text dimColor>none</Text>
          : tgts.map(t => <Text key={t}>  {t}</Text>)}
        <Text> </Text>

        <Text bold>Findings: {eng.findingCount}</Text>
        <Text> </Text>

        <Text bold>Recent activity</Text>
        {evts.length === 0
          ? <Text dimColor>none</Text>
          : evts.slice(0, room).map(ev => (
              <Text key={ev.id} dimColor>
                [{ev.phase}] {ev.action}
              </Text>
            ))}
      </Box>
    )
  })
}
