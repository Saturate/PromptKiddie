
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionGraph } from "@promptkiddie/core";
import { type ActionNodeWithState, buildEmitterMap, buildConsumerMap } from "./graph-helpers";

export interface ReplayEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  createdAt: string;
}

export interface ReplayState {
  loading: boolean;
  playing: boolean;
  autoPlay: boolean;
  currentIndex: number;
  activeNodes: Set<string>;
  doneNodes: Set<string>;
  activeEdges: Set<string>;
  log: Array<{ time: number; event: ReplayEvent }>;
  speed: number;
  events: ReplayEvent[];
  totalDuration: number;
  /** WebSocket is connected and feeding live events */
  live: boolean;
  liveConnected: boolean;
  /** Tool output lines from the live WebSocket */
  outputLines: Array<{ action: string; line: string; time: string }>;
}

interface WsEventMessage {
  type: "event";
  data: { id: string; type: string; payload: Record<string, unknown>; source: string; createdAt: string };
}
interface WsActionStartMessage { type: "action_start"; data: { name: string } }
interface WsActionEndMessage { type: "action_end"; data: { name: string } }
interface WsOutputMessage { type: "output"; data: { action: string; line: string } }

export type WsMessage = WsEventMessage | WsActionStartMessage | WsActionEndMessage | WsOutputMessage;

export function findNodeByName(nodes: ActionNodeWithState[], name: string): ActionNodeWithState | undefined {
  const lower = name.toLowerCase();
  return nodes.find((n) => n.name.toLowerCase() === lower || n.id.toLowerCase() === lower);
}

/** Process a WebSocket message against the current replay state. Pure function for testing. */
export function processWsMessage(
  msg: WsMessage,
  prev: ReplayState,
  nodes: ActionNodeWithState[],
  edges: ActionGraph["edges"],
): ReplayState {
  const consumerMap = buildConsumerMap(nodes, edges);
  const emitterMap = buildEmitterMap(nodes);

  switch (msg.type) {
    case "event": {
      const eventData = msg.data;
      const newEvent: ReplayEvent = {
        id: eventData.id,
        type: eventData.type,
        payload: eventData.payload,
        source: eventData.source,
        createdAt: eventData.createdAt,
      };

      const triggered = consumerMap.get(eventData.type) ?? [];
      const emitters = emitterMap.get(eventData.type) ?? [];

      const newActive = new Set(prev.activeNodes);
      const newDone = new Set(prev.doneNodes);
      const newActiveEdges = new Set<string>();

      for (const nodeId of prev.activeNodes) {
        if (!triggered.includes(nodeId)) {
          newDone.add(nodeId);
          newActive.delete(nodeId);
        }
      }
      for (const nodeId of triggered) newActive.add(nodeId);

      for (const emitter of emitters) {
        for (const consumer of triggered) {
          newActiveEdges.add(`${emitter}->${consumer}`);
        }
      }
      if (eventData.type === "EngagementStarted") {
        for (const consumer of triggered) {
          newActiveEdges.add(`__start__->${consumer}`);
        }
      }

      const newEvents = [...prev.events, newEvent];
      const firstTime = newEvents.length > 0 ? new Date(newEvents[0].createdAt).getTime() : 0;
      const elapsed = (new Date(newEvent.createdAt).getTime() - firstTime) / 1000;

      return {
        ...prev,
        events: newEvents,
        currentIndex: newEvents.length - 1,
        activeNodes: newActive,
        doneNodes: newDone,
        activeEdges: newActiveEdges,
        log: [...prev.log, { time: elapsed, event: newEvent }],
        totalDuration: elapsed,
      };
    }

    case "action_start": {
      const node = findNodeByName(nodes, msg.data.name);
      if (!node) return prev;
      const newActive = new Set(prev.activeNodes);
      newActive.add(node.id);
      return { ...prev, activeNodes: newActive };
    }

    case "action_end": {
      const node = findNodeByName(nodes, msg.data.name);
      if (!node) return prev;
      const newActive = new Set(prev.activeNodes);
      const newDone = new Set(prev.doneNodes);
      newActive.delete(node.id);
      newDone.add(node.id);
      return { ...prev, activeNodes: newActive, doneNodes: newDone };
    }

    case "output": {
      return {
        ...prev,
        outputLines: [...prev.outputLines, {
          action: msg.data.action,
          line: msg.data.line,
          time: new Date().toISOString(),
        }],
      };
    }

    default:
      return prev;
  }
}

export function computeGraphState(
  events: ReplayEvent[],
  nodes: ActionNodeWithState[],
  edges: ActionGraph["edges"],
  targetIndex: number,
) {
  const consumerMap = buildConsumerMap(nodes, edges);
  const emitterMap = buildEmitterMap(nodes);
  const firstTime = events.length > 0 ? new Date(events[0].createdAt).getTime() : 0;

  const doneNodes = new Set<string>();
  const log: Array<{ time: number; event: ReplayEvent }> = [];

  for (let i = 0; i <= targetIndex && i < events.length; i++) {
    const ev = events[i];
    const triggered = consumerMap.get(ev.type) ?? [];
    for (const nodeId of triggered) doneNodes.add(nodeId);
    const elapsed = (new Date(ev.createdAt).getTime() - firstTime) / 1000;
    log.push({ time: elapsed, event: ev });
  }

  const currentEvent = events[targetIndex];
  const triggered = currentEvent ? (consumerMap.get(currentEvent.type) ?? []) : [];
  const emitters = currentEvent ? (emitterMap.get(currentEvent.type) ?? []) : [];
  const activeNodes = new Set(triggered);
  const activeEdges = new Set<string>();
  for (const emitter of emitters) {
    for (const consumer of triggered) {
      activeEdges.add(`${emitter}->${consumer}`);
    }
  }
  if (currentEvent?.type === "EngagementStarted") {
    for (const consumer of triggered) {
      activeEdges.add(`__start__->${consumer}`);
    }
  }
  for (const nodeId of activeNodes) doneNodes.delete(nodeId);

  return { activeNodes, doneNodes, activeEdges, log };
}

interface UseReplayOpts {
  graph: (ActionGraph & { nodes: ActionNodeWithState[] }) | null;
  wsUrl?: string;
}

const DEFAULT_WS_URL = "ws://localhost:3200";

export function useReplay({ graph, wsUrl }: UseReplayOpts) {
  const [state, setState] = useState<ReplayState>({
    loading: false,
    playing: false,
    autoPlay: false,
    currentIndex: -1,
    activeNodes: new Set(),
    doneNodes: new Set(),
    activeEdges: new Set(),
    log: [],
    speed: 1,
    events: [],
    totalDuration: 0,
    live: false,
    liveConnected: false,
    outputLines: [],
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const wsRef = useRef<WebSocket | null>(null);

  // --- Core replay logic ---

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setState((prev) => ({
      ...prev,
      playing: false,
      autoPlay: false,
      currentIndex: -1,
      activeNodes: new Set(),
      doneNodes: new Set(),
      activeEdges: new Set(),
      log: [],
      live: false,
      liveConnected: false,
      outputLines: [],
    }));
  }, []);

  const stepTo = useCallback((index: number) => {
    const g = graphRef.current;
    const events = stateRef.current.events;
    if (!g || index >= events.length) {
      // If live, don't stop playing; just wait for more events
      if (!stateRef.current.live) {
        setState((prev) => ({ ...prev, playing: false, activeNodes: new Set() }));
      }
      return;
    }

    const event = events[index];
    const consumerMap = buildConsumerMap(g.nodes, g.edges);
    const emitterMap = buildEmitterMap(g.nodes);

    const triggered = consumerMap.get(event.type) ?? [];
    const emitters = emitterMap.get(event.type) ?? [];

    const newActive = new Set(triggered);
    const newActiveEdges = new Set<string>();
    for (const emitter of emitters) {
      for (const consumer of triggered) {
        newActiveEdges.add(`${emitter}->${consumer}`);
      }
    }
    if (event.type === "EngagementStarted") {
      for (const consumer of triggered) {
        newActiveEdges.add(`__start__->${consumer}`);
      }
    }

    const firstTime = new Date(events[0].createdAt).getTime();
    const eventTime = new Date(event.createdAt).getTime();
    const elapsed = (eventTime - firstTime) / 1000;

    setState((prev) => ({
      ...prev,
      currentIndex: index,
      activeNodes: newActive,
      activeEdges: newActiveEdges,
      doneNodes: new Set([...prev.doneNodes, ...prev.activeNodes]),
      log: [...prev.log, { time: elapsed, event }],
    }));

    if (index + 1 < events.length && stateRef.current.playing) {
      const currentTime = new Date(event.createdAt).getTime();
      const nextTime = new Date(events[index + 1].createdAt).getTime();
      const delta = Math.max((nextTime - currentTime) / stateRef.current.speed, 50);
      timerRef.current = setTimeout(() => stepTo(index + 1), delta);
    } else if (index + 1 >= events.length && !stateRef.current.live) {
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          playing: false,
          doneNodes: new Set([...prev.doneNodes, ...prev.activeNodes]),
          activeNodes: new Set(),
          activeEdges: new Set(),
        }));
      }, 1000 / stateRef.current.speed);
    }
    // If live and at end, just wait; onmessage will append events and trigger next step
  }, []);

  const play = useCallback(() => {
    if (stateRef.current.events.length === 0) return;
    setState((prev) => ({ ...prev, playing: true }));
    const startIdx = stateRef.current.currentIndex + 1;
    if (startIdx === 0) {
      stepTo(0);
    } else if (startIdx < stateRef.current.events.length) {
      const events = stateRef.current.events;
      const currentTime = new Date(events[startIdx - 1].createdAt).getTime();
      const nextTime = new Date(events[startIdx].createdAt).getTime();
      const delta = Math.max((nextTime - currentTime) / stateRef.current.speed, 50);
      timerRef.current = setTimeout(() => stepTo(startIdx), delta);
    }
  }, [stepTo]);

  const pause = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((prev) => ({ ...prev, playing: false }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const seekTo = useCallback((index: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const g = graphRef.current;
    const events = stateRef.current.events;
    if (!g || index < 0 || index >= events.length) return;

    const { activeNodes, doneNodes, activeEdges, log } = computeGraphState(events, g.nodes, g.edges, index);

    setState((prev) => ({
      ...prev,
      playing: false,
      currentIndex: index,
      activeNodes,
      doneNodes,
      activeEdges,
      log,
    }));
  }, []);

  // --- Load events from DB ---

  const loadEvents = useCallback(async (engagementId: string, autoPlay = false) => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/playbook/events?engagement=${engagementId}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const events: ReplayEvent[] = await res.json();

      let totalDuration = 0;
      if (events.length >= 2) {
        const first = new Date(events[0].createdAt).getTime();
        const last = new Date(events[events.length - 1].createdAt).getTime();
        totalDuration = (last - first) / 1000;
      }

      setState((prev) => ({
        ...prev,
        loading: false,
        autoPlay,
        events,
        totalDuration,
        currentIndex: -1,
        playing: false,
        activeNodes: new Set(),
        doneNodes: new Set(),
        activeEdges: new Set(),
        log: [],
        live: false,
        liveConnected: false,
        outputLines: [],
      }));
    } catch {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  // --- Live mode: load DB events, seek to end, connect WebSocket ---

  const goLive = useCallback(async (engagementId: string) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (timerRef.current) clearTimeout(timerRef.current);

    setState((prev) => ({ ...prev, loading: true }));

    let events: ReplayEvent[] = [];
    try {
      const res = await fetch(`/api/playbook/events?engagement=${engagementId}`);
      if (res.ok) events = await res.json();
    } catch { /* proceed with empty history */ }

    const g = graphRef.current;
    let graphState: ReturnType<typeof computeGraphState> | null = null;
    if (g && events.length > 0) {
      graphState = computeGraphState(events, g.nodes, g.edges, events.length - 1);
    }

    let totalDuration = 0;
    if (events.length >= 2) {
      const first = new Date(events[0].createdAt).getTime();
      const last = new Date(events[events.length - 1].createdAt).getTime();
      totalDuration = (last - first) / 1000;
    }

    setState((prev) => ({
      ...prev,
      loading: false,
      autoPlay: false,
      events,
      totalDuration,
      currentIndex: events.length - 1,
      playing: true,
      activeNodes: graphState?.activeNodes ?? new Set(),
      doneNodes: graphState?.doneNodes ?? new Set(),
      activeEdges: graphState?.activeEdges ?? new Set(),
      log: graphState?.log ?? [],
      live: true,
      liveConnected: false,
      outputLines: [],
    }));

    // Connect WebSocket
    const url = wsUrl ?? DEFAULT_WS_URL;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setState((prev) => ({ ...prev, liveConnected: true }));
    };

    socket.onclose = () => {
      setState((prev) => ({ ...prev, liveConnected: false }));
    };

    socket.onerror = () => {
      setState((prev) => ({ ...prev, liveConnected: false }));
    };

    socket.onmessage = (ev) => {
      const g2 = graphRef.current;
      if (!g2) return;

      let msg: WsMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WsMessage;
      } catch { return; }

      setState((prev) => processWsMessage(msg, prev, g2.nodes, g2.edges));
    };
  }, [wsUrl]);

  const stopLive = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setState((prev) => ({
      ...prev,
      live: false,
      liveConnected: false,
      playing: false,
    }));
  }, []);

  // --- Effects ---

  // Auto-play once events are loaded (for pure replay mode)
  useEffect(() => {
    if (state.autoPlay && state.events.length > 0 && !state.playing && state.currentIndex === -1) {
      setState((prev) => ({ ...prev, autoPlay: false }));
      play();
    }
  }, [state.autoPlay, state.events.length, state.playing, state.currentIndex, play]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, []);

  // Speed change during playback
  useEffect(() => {
    if (state.playing && state.currentIndex >= 0 && !state.live) {
      const events = state.events;
      const nextIdx = state.currentIndex + 1;
      if (nextIdx < events.length) {
        const currentTime = new Date(events[state.currentIndex].createdAt).getTime();
        const nextTime = new Date(events[nextIdx].createdAt).getTime();
        const delta = Math.max((nextTime - currentTime) / state.speed, 50);
        timerRef.current = setTimeout(() => stepTo(nextIdx), delta);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.speed]);

  return { state, loadEvents, goLive, stopLive, play, pause, reset, setSpeed, seekTo };
}
