"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionGraph, ActionNode, ActionEdge } from "@promptkiddie/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionNodeWithState extends ActionNode {
  running: number;
  eventCount: number;
}

/** Incoming WebSocket messages from the supervisor. */
interface WsEventMessage {
  type: "event";
  data: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
    source: string;
    createdAt: string;
  };
}

interface WsActionStartMessage {
  type: "action_start";
  data: { name: string };
}

interface WsActionEndMessage {
  type: "action_end";
  data: { name: string };
}

interface WsOutputMessage {
  type: "output";
  data: { action: string; line: string };
}

type WsMessage =
  | WsEventMessage
  | WsActionStartMessage
  | WsActionEndMessage
  | WsOutputMessage;

export interface LiveEvent {
  time: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface LiveOutputLine {
  action: string;
  line: string;
  time: string;
}

export interface LiveState {
  connected: boolean;
  activeNodes: Set<string>;
  doneNodes: Set<string>;
  activeEdges: Set<string>;
  log: LiveEvent[];
  outputLines: LiveOutputLine[];
}

// ---------------------------------------------------------------------------
// Graph helpers (reused from simulation logic)
// ---------------------------------------------------------------------------

function buildEmitterMap(nodes: ActionNodeWithState[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    for (const eventType of node.emits) {
      const list = map.get(eventType) ?? [];
      list.push(node.id);
      map.set(eventType, list);
    }
  }
  return map;
}

function buildConsumerMap(
  nodes: ActionNodeWithState[],
  edges: ActionEdge[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.event) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    map.set(edge.event, list);
  }
  const startEdges = edges.filter((e) => e.from === "__start__");
  if (startEdges.length > 0) {
    const existing = map.get("EngagementStarted") ?? [];
    for (const se of startEdges) {
      if (!existing.includes(se.to)) existing.push(se.to);
    }
    map.set("EngagementStarted", existing);
  }
  return map;
}

/** Find the action node whose name matches (case-insensitive, normalized). */
function findNodeByName(
  nodes: ActionNodeWithState[],
  name: string,
): ActionNodeWithState | undefined {
  const lower = name.toLowerCase();
  return nodes.find((n) => n.name.toLowerCase() === lower || n.id.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_WS_URL = "ws://localhost:3200";

interface UseLiveModeOpts {
  graph: (ActionGraph & { nodes: ActionNodeWithState[] }) | null;
  engagementId: string | null;
  wsUrl?: string;
}

export function useLiveMode({ graph, engagementId, wsUrl }: UseLiveModeOpts) {
  const [state, setState] = useState<LiveState>({
    connected: false,
    activeNodes: new Set(),
    doneNodes: new Set(),
    activeEdges: new Set(),
    log: [],
    outputLines: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState({
      connected: false,
      activeNodes: new Set(),
      doneNodes: new Set(),
      activeEdges: new Set(),
      log: [],
      outputLines: [],
    });
  }, []);

  const connect = useCallback(() => {
    if (!engagementId) return;
    disconnect();

    const url = wsUrl ?? DEFAULT_WS_URL;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    socket.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    socket.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    socket.onmessage = (ev) => {
      const g = graphRef.current;
      if (!g) return;

      let msg: WsMessage;
      try {
        msg = JSON.parse(String(ev.data)) as WsMessage;
      } catch {
        return;
      }

      const consumerMap = buildConsumerMap(g.nodes, g.edges);
      const emitterMap = buildEmitterMap(g.nodes);

      setState((prev) => {
        switch (msg.type) {
          case "event": {
            const eventData = msg.data;
            const triggered = consumerMap.get(eventData.type) ?? [];
            const emitters = emitterMap.get(eventData.type) ?? [];

            // Merge triggered into active, move previous active to done
            const newActive = new Set(prev.activeNodes);
            const newDone = new Set(prev.doneNodes);
            const newActiveEdges = new Set<string>();

            // Nodes that were active and are not re-triggered become done
            for (const nodeId of prev.activeNodes) {
              if (!triggered.includes(nodeId)) {
                newDone.add(nodeId);
                newActive.delete(nodeId);
              }
            }

            for (const nodeId of triggered) {
              newActive.add(nodeId);
            }

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

            const logEntry: LiveEvent = {
              time: eventData.createdAt,
              type: eventData.type,
              payload: eventData.payload,
              source: eventData.source,
            };

            return {
              ...prev,
              activeNodes: newActive,
              doneNodes: newDone,
              activeEdges: newActiveEdges,
              log: [...prev.log, logEntry],
            };
          }

          case "action_start": {
            const node = findNodeByName(g.nodes, msg.data.name);
            if (!node) return prev;
            const newActive = new Set(prev.activeNodes);
            newActive.add(node.id);
            return { ...prev, activeNodes: newActive };
          }

          case "action_end": {
            const node = findNodeByName(g.nodes, msg.data.name);
            if (!node) return prev;
            const newActive = new Set(prev.activeNodes);
            const newDone = new Set(prev.doneNodes);
            newActive.delete(node.id);
            newDone.add(node.id);
            return { ...prev, activeNodes: newActive, doneNodes: newDone };
          }

          case "output": {
            const outputLine: LiveOutputLine = {
              action: msg.data.action,
              line: msg.data.line,
              time: new Date().toISOString(),
            };
            return {
              ...prev,
              outputLines: [...prev.outputLines, outputLine],
            };
          }

          default:
            return prev;
        }
      });
    };
  }, [engagementId, wsUrl, disconnect]);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { state, connect, disconnect };
}
