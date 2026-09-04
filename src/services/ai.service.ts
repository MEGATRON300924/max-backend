import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export type ChatTurn = {
  role: 'user' | 'model';
  content: string;
};

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiFunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type InteractionStep = {
  type?: string;
  id?: string;
  name?: string;
  call_id?: string;
  arguments?: Record<string, unknown> | string;
  content?: Array<{ type?: string; text?: string }>;
};

type InteractionPayload = {
  id?: string;
  model?: string;
  status?: string;
  steps?: InteractionStep[];
  output_text?: string;
};

type FunctionResult = {
  name: string;
  callId: string;
  result: unknown;
};

type StreamFunctionCall = {
  id: string;
  name: string;
  arguments: string;
};

type StreamResult = {
  text: string;
  functionCalls: GeminiFunctionCall[];
  interactionId: string | null;
  status: string | null;
};

function assertConfigured() {
  if (!env.GEMINI_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The MAX AI provider is not configured');
  }
}

function interactionInput(turns: ChatTurn[]) {
  return turns.map((turn) => ({
    type: turn.role === 'user' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: turn.content }]
  }));
}

function extract(payload: InteractionPayload) {
  const steps = payload.steps ?? [];
  const text = payload.output_text?.trim() || steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  const functionCalls = steps.flatMap((step): GeminiFunctionCall[] => {
    if (step.type !== 'function_call' || !step.name) return [];
    let args: Record<string, unknown> = {};
    if (typeof step.arguments === 'string') {
      try {
        const parsed = JSON.parse(step.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (step.arguments && typeof step.arguments === 'object') {
      args = step.arguments;
    }
    return [{
      id: step.call_id ?? step.id ?? crypto.randomUUID(),
      name: step.name,
      args
    }];
  });

  return { text, functionCalls };
}

function functionTools(functions: GeminiFunctionDeclaration[]) {
  return functions.map((functionDeclaration) => ({
    type: 'function',
    ...functionDeclaration
  }));
}

function requestBody(turns: ChatTurn[], functions: GeminiFunctionDeclaration[], systemInstruction?: string) {
  return {
    model: env.GEMINI_MODEL,
    input: interactionInput(turns),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(functions.length ? { tools: functionTools(functions) } : {})
  };
}

async function postInteraction(body: Record<string, unknown>) {
  assertConfigured();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY!
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const providerMessage = await response.text().catch(() => '');
    throw new ApiError(502, 'AI_PROVIDER_ERROR', providerMessage.slice(0, 500) || 'The MAX AI provider could not complete the request');
  }

  return (await response.json()) as InteractionPayload;
}

export async function generateGeminiResponse(turns: ChatTurn[]) {
  const result = await generateGeminiResponseWithTools(turns);
  if (!result.text) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { text: result.text, provider: 'gemini', model: env.GEMINI_MODEL, interactionId: result.interactionId };
}

export async function generateGeminiResponseWithTools(turns: ChatTurn[], functions: GeminiFunctionDeclaration[] = [], systemInstruction?: string) {
  const payload = await postInteraction(requestBody(turns, functions, systemInstruction));
  const extracted = extract(payload);
  return {
    ...extracted,
    provider: 'gemini',
    model: env.GEMINI_MODEL,
    interactionId: payload.id ?? null
  };
}

export async function continueGeminiInteraction(
  interactionId: string,
  functionResults: FunctionResult[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction?: string
) {
  const payload = await postInteraction({
    model: env.GEMINI_MODEL,
    previous_interaction_id: interactionId,
    input: functionResults.map((item) => ({
      type: 'function_result',
      name: item.name,
      call_id: item.callId,
      result: [{ type: 'text', text: JSON.stringify(item.result) }]
    })),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(functions.length ? { tools: functionTools(functions) } : {})
  });
  const extracted = extract(payload);
  return {
    ...extracted,
    provider: 'gemini',
    model: env.GEMINI_MODEL,
    interactionId: payload.id ?? interactionId
  };
}

function parseStreamEvent(raw: string) {
  try {
    return JSON.parse(raw) as {
      event_type?: string;
      type?: string;
      interaction?: { id?: string; status?: string };
      delta?: { type?: string; text?: string; arguments?: string };
      step?: { type?: string; id?: string; name?: string; call_id?: string; arguments?: Record<string, unknown> | string };
      index?: number;
    };
  } catch {
    return null;
  }
}

async function streamInteraction(
  body: Record<string, unknown>,
  onText: (text: string) => void
): Promise<StreamResult> {
  assertConfigured();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      'x-goog-api-key': env.GEMINI_API_KEY!
    },
    body: JSON.stringify({ ...body, stream: true })
  });

  if (!response.ok || !response.body) {
    const providerMessage = await response.text().catch(() => '');
    throw new ApiError(502, 'AI_PROVIDER_ERROR', providerMessage.slice(0, 500) || 'The MAX AI provider could not start the stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, StreamFunctionCall>();
  let buffer = '';
  let fullText = '';
  let interactionId: string | null = null;
  let status: string | null = null;

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      const event = parseStreamEvent(raw);
      if (!event) continue;
      const eventType = event.event_type ?? event.type;

      if (eventType === 'interaction.created' && event.interaction?.id) {
        interactionId = event.interaction.id;
        status = event.interaction.status ?? status;
        continue;
      }

      if ((eventType === 'interaction.completed' || eventType === 'interaction.requires_action' || eventType === 'interaction.status_update') && event.interaction) {
        interactionId = event.interaction.id ?? interactionId;
        status = event.interaction.status ?? status;
        continue;
      }

      if (eventType === 'step.start' && event.step?.type === 'function_call' && typeof event.index === 'number' && event.step.name) {
        let argumentsValue = '';
        if (typeof event.step.arguments === 'string') argumentsValue = event.step.arguments;
        else if (event.step.arguments && typeof event.step.arguments === 'object') argumentsValue = JSON.stringify(event.step.arguments);
        calls.set(event.index, {
          id: event.step.call_id ?? event.step.id ?? crypto.randomUUID(),
          name: event.step.name,
          arguments: argumentsValue
        });
        continue;
      }

      if (eventType === 'step.delta' && typeof event.index === 'number' && event.delta) {
        if (event.delta.type === 'text') {
          const text = event.delta.text ?? '';
          if (text) {
            fullText += text;
            onText(text);
          }
        } else if (event.delta.type === 'arguments_delta') {
          const call = calls.get(event.index);
          if (call) call.arguments += event.delta.arguments ?? '';
        } else if (event.delta.type === 'arguments') {
          const call = calls.get(event.index);
          if (call) call.arguments += event.delta.arguments ?? '';
        }
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());

  const functionCalls = [...calls.values()].map((call) => {
    let args: Record<string, unknown> = {};
    if (call.arguments.trim()) {
      try {
        const parsed = JSON.parse(call.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        throw new ApiError(502, 'AI_INVALID_TOOL_ARGUMENTS', 'The MAX AI provider returned invalid tool arguments');
      }
    }
    return { id: call.id, name: call.name, args };
  });

  return { text: fullText, functionCalls, interactionId, status };
}

export async function streamGeminiResponseWithTools(
  turns: ChatTurn[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction: string | undefined,
  onText: (text: string) => void
) {
  const result = await streamInteraction(requestBody(turns, functions, systemInstruction), onText);
  if (!result.interactionId) throw new ApiError(502, 'AI_MISSING_INTERACTION_ID', 'The MAX AI provider returned no interaction identifier');
  if (!result.text.trim() && !result.functionCalls.length) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { ...result, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiInteraction(
  interactionId: string,
  functionResults: FunctionResult[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction: string | undefined,
  onText: (text: string) => void
) {
  const result = await streamInteraction({
    model: env.GEMINI_MODEL,
    previous_interaction_id: interactionId,
    input: functionResults.map((item) => ({
      type: 'function_result',
      name: item.name,
      call_id: item.callId,
      result: [{ type: 'text', text: JSON.stringify(item.result) }]
    })),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(functions.length ? { tools: functionTools(functions) } : {})
  }, onText);
  if (!result.interactionId) throw new ApiError(502, 'AI_MISSING_INTERACTION_ID', 'The MAX AI provider returned no interaction identifier');
  if (!result.text.trim() && !result.functionCalls.length) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { ...result, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiResponse(turns: ChatTurn[], onText: (text: string) => void) {
  return streamGeminiResponseWithTools(turns, [], undefined, onText);
}
