/**
 * Manual agent loop for providers where the AI SDK's maxSteps doesn't
 * work (e.g. @ai-sdk/openai-compatible with Ollama).
 *
 * Calls generateText with maxSteps:1 per turn, accumulating messages
 * until the model stops requesting tool calls or maxTurns is reached.
 */
import { generateText, type ToolSet } from "ai";
import type { LanguageModelV1 } from "@ai-sdk/provider";

interface AgentLoopOptions {
  model: LanguageModelV1;
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  tools: ToolSet;
  maxTurns?: number;
  telemetry?: Record<string, unknown>;
  onToolCall?: (name: string, args: unknown) => void;
  onText?: (text: string) => void;
}

export async function agentLoop({
  model,
  system,
  messages,
  tools,
  maxTurns = 20,
  telemetry,
  onToolCall,
  onText,
}: AgentLoopOptions) {
  const history = [...messages];
  let fullText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await generateText({
      model,
      system,
      messages: history as Parameters<typeof generateText>[0]["messages"],
      maxSteps: 1,
      tools,
      experimental_telemetry: telemetry as Parameters<typeof generateText>[0]["experimental_telemetry"],
    });

    const step = result.steps[0];
    if (!step) break;

    for (const msg of step.response.messages) {
      history.push(msg as (typeof history)[number]);
    }

    if (step.toolCalls?.length) {
      for (const tc of step.toolCalls) {
        onToolCall?.(tc.toolName, tc.args);
      }
    }

    if (step.text) {
      fullText += step.text;
      onText?.(step.text);
    }

    if (!step.toolCalls?.length) break;
  }

  return { text: fullText, messages: history };
}
