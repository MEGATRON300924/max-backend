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

type FunctionResult = {
  name: string;
  callId: string;
  result: unknown;
};

type InteractionStep = {
  type?: string;
  id?: string;
  name?: string;
  call_id?: string;
  arguments?: Record<string, unknown> | string;
  content?: Array<{ type?: string; text?: string }>;
};
type InteractionPayload = { id?: string; model?: string; status?: string; steps?: InteractionStep[]; output_text?: string };
type StreamResult = {
  text: string;
  functionCalls: GeminiFunctionCall[];
  interactionId: string | null;
  status: string | null;
};

function extractGemini(payload: InteractionPayload) {
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
        const parsed: unknown = JSON.parse(step.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch { args = {}; }
    } else if (step.arguments && typeof step.arguments === 'object') args = step.arguments;
    return [{ id: step.call_id ?? step.id ?? crypto.randomUUID(), name: step.name, args }];
  });
  return { text, functionCalls };
}

function interactionInput(turns: ChatTurn[]) {
  return turns.map((turn) => ({
    type: turn.role === 'user' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: turn.content }]
  }));
}

function functionTools(functions: GeminiFunctionDeclaration[]) {
  return functions.map((item) => ({ type: 'function', ...item }));
}

function geminiRequestBody(turns: ChatTurn[], functions: GeminiFunctionDeclaration[], systemInstruction?: string) {
  return {
    model: env.GEMINI_MODEL,
    input: interactionInput(turns),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(functions.length ? { tools: functionTools(functions) } : {})
  };
}

async function postGeminiInteraction(body: Record<string, unknown>) {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Gemini is not configured for this feature');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const providerMessage = await response.text().catch(() => '');
    throw new ApiError(502, 'AI_PROVIDER_ERROR', providerMessage.slice(0, 500) || 'Gemini could not complete the request');
  }
  return await response.json() as InteractionPayload;
}

export async function generateGeminiResponse(turns: ChatTurn[]) {
  const result = await generateGeminiResponseWithTools(turns);
  if (!result.text) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The AI provider returned no response');
  return { text: result.text, provider: result.provider, model: result.model, interactionId: result.interactionId };
}

export async function generateGeminiResponseWithTools(
  turns: ChatTurn[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction?: string
) {
  const payload = await postGeminiInteraction(geminiRequestBody(turns, functions, systemInstruction));
  const extracted = extractGemini(payload);
  return { ...extracted, provider: 'gemini', model: env.GEMINI_MODEL, interactionId: payload.id ?? null };
}

export async function continueGeminiInteraction(
  interactionId: string,
  functionResults: FunctionResult[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction?: string
) {
  const payload = await postGeminiInteraction({
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
  const extracted = extractGemini(payload);
  return { ...extracted, provider: 'gemini', model: env.GEMINI_MODEL, interactionId: payload.id ?? interactionId };
}

async function streamGemini(
  body: Record<string, unknown>,
  onText: (text: string) => void
): Promise<StreamResult> {
  if (!env.GEMINI_API_KEY) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Gemini is not configured for this feature');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!response.ok || !response.body) {
    const providerMessage = await response.text().catch(() => '');
    throw new ApiError(502, 'AI_PROVIDER_ERROR', providerMessage.slice(0, 500) || 'Gemini could not start the stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
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
      let event: any;
      try { event = JSON.parse(raw); } catch { continue; }
      const eventType = event.event_type ?? event.type;
      if (eventType === 'interaction.created' && event.interaction?.id) {
        interactionId = event.interaction.id;
        status = event.interaction.status ?? status;
      } else if (['interaction.completed', 'interaction.requires_action', 'interaction.status_update'].includes(eventType) && event.interaction) {
        interactionId = event.interaction.id ?? interactionId;
        status = event.interaction.status ?? status;
      } else if (eventType === 'step.start' && event.step?.type === 'function_call' && typeof event.index === 'number' && event.step.name) {
        // Interactions API starts streamed function calls with arguments: {}.
        // That is a placeholder, not a JSON prefix: appending argument deltas
        // to the literal "{}" corrupts an otherwise valid function call.
        let args = '';
        if (typeof event.step.arguments === 'string') args = event.step.arguments;
        else if (event.step.arguments && typeof event.step.arguments === 'object' && Object.keys(event.step.arguments).length > 0) {
          args = JSON.stringify(event.step.arguments);
        }
        calls.set(event.index, { id: event.step.call_id ?? event.step.id ?? crypto.randomUUID(), name: event.step.name, arguments: args });
      } else if (eventType === 'step.delta' && typeof event.index === 'number' && event.delta) {
        if (event.delta.type === 'text') {
          const text = event.delta.text ?? '';
          if (text) { fullText += text; onText(text); }
        } else if (event.delta.type === 'arguments_delta' || event.delta.type === 'arguments') {
          const call = calls.get(event.index);
          // The API has used both arguments_delta/arguments and
          // arguments/partial_arguments event shapes across its examples.
          const fragment = typeof event.delta.arguments === 'string'
            ? event.delta.arguments
            : typeof event.delta.partial_arguments === 'string'
              ? event.delta.partial_arguments
              : '';
          if (call) call.arguments += fragment;
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
        const parsed: unknown = JSON.parse(call.arguments);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch { throw new ApiError(502, 'AI_INVALID_TOOL_ARGUMENTS', 'Gemini returned invalid tool arguments'); }
    }
    return { id: call.id, name: call.name, args };
  });
  if (!interactionId) throw new ApiError(502, 'AI_MISSING_INTERACTION_ID', 'Gemini returned no interaction identifier');
  if (!fullText.trim() && !functionCalls.length) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'Gemini returned no response');
  return { text: fullText, functionCalls, interactionId, status };
}

export async function streamGeminiResponseWithTools(
  turns: ChatTurn[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction: string | undefined,
  onText: (text: string) => void
) {
  const result = await streamGemini(geminiRequestBody(turns, functions, systemInstruction), onText);
  return { ...result, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiInteraction(
  interactionId: string,
  functionResults: FunctionResult[],
  functions: GeminiFunctionDeclaration[] = [],
  systemInstruction: string | undefined,
  onText: (text: string) => void
) {
  const result = await streamGemini({
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
  return { ...result, provider: 'gemini', model: env.GEMINI_MODEL };
}

export async function streamGeminiResponse(turns: ChatTurn[], onText: (text: string) => void) {
  return streamGeminiResponseWithTools(turns, [], undefined, onText);
}
