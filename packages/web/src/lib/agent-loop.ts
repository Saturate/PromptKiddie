/**
 * Manual agent loop for providers where the AI SDK's maxSteps doesn't
 * work (e.g. @ai-sdk/openai-compatible with Ollama).
 *
 * Calls generateText with maxSteps:1 per turn, accumulating messages
 * until the model stops requesting tool calls or maxTurns is reached.
 */
import { generateText, isStepCount, type ToolSet, type LanguageModel } from "ai";

interface AgentLoopOptions {
  model: LanguageModel;
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  tools: ToolSet;
  maxTurns?: number;
  maxRepeats?: number;
  telemetry?: Record<string, unknown>;
  onToolCall?: (name: string, args: unknown) => void;
  onText?: (text: string) => void;
  onStuck?: (toolName: string, count: number) => void;
}

function callSignature(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args)}`;
}

export async function agentLoop({
  model,
  system,
  messages,
  tools,
  maxTurns = 20,
  maxRepeats = 3,
  telemetry,
  onToolCall,
  onText,
  onStuck,
}: AgentLoopOptions) {
  const history = [...messages];
  let fullText = "";
  const recentCalls: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await generateText({
      model,
      system,
      messages: history,
      stopWhen: [isStepCount(1)],
      tools,
    } as Parameters<typeof generateText>[0]);

    const step = result.steps[0];
    if (!step) break;

    for (const msg of step.response.messages) {
      history.push(msg as (typeof history)[number]);
    }

    if (step.toolCalls?.length) {
      for (const tc of step.toolCalls) {
        onToolCall?.(tc.toolName, tc.input);

        const sig = callSignature(tc.toolName, tc.input);
        recentCalls.push(sig);
        if (recentCalls.length > maxRepeats) recentCalls.shift();

        if (recentCalls.length >= maxRepeats && recentCalls.every((c) => c === sig)) {
          onStuck?.(tc.toolName, maxRepeats);
          fullText += `\n[Stopped: repeated ${tc.toolName} call ${maxRepeats} times with identical arguments]`;
          return { text: fullText, messages: history, stuck: true };
        }
      }
    }

    if (step.text) {
      fullText += step.text;
      onText?.(step.text);
    }

    if (!step.toolCalls?.length) break;
  }

  return { text: fullText, messages: history, stuck: false };
}
