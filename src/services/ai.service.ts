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
  arguments?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
};

type InteractionPayload = {
  id?: string;
  model?: string;
  steps?: InteractionStep[];
  output_text?: string;
};

type FunctionResult = {
  name: string;
  callId: string;
  result: unknown;
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
    return [{
      id: step.call_id ?? step.id ?? crypto.randomUUID(),
      name: step.name,
      args: step.arguments ?? {}
    }];
  });

  return { text, functionCalls };
}

function requestBody(turns: ChatTurn[], functions: GeminiFunctionDeclaration[], systemInstruction?: string) {
  return JSON.stringify({
    model: env.GEMINI_MODEL,
    input: interactionInput(turns),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(functions.length ? {
      tools: functions.map((functionDeclaration) => ({
        type: 'function',
        ...functionDeclaration
      }))
    } : {})
  });
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
  const payload = await postInteraction(JSON.parse(requestBody(turns, functions, systemInstruction)) as Record<string, unknown>);
  const extracted = extract(payload);
  return {
    ...extracted,
    provider: 'gemini',
    model: env.GEMINI_MODEL,
    interactionId: payload.id ?? null
  };
}

export async function continueGeminiInteraction(interactionId: string, functionResults: FunctionResult[], functions: GeminiFunctionDeclaration[] = []) {
  const payload = await postInteraction({
    model: env.GEMINI_MODEL,
    previous_interaction_id: interactionId,
    input: functionResults.map((item) => ({
      type: 'function_result',
      name: item.name,
      call_id: item.callId,
      result: [{ type: 'text', text: JSON.stringify(item.result) }]
    })),
    ...(functions.length ? {
      tools: functions.map((functionDeclaration) => ({
        type: 'function',
        ...functionDeclaration
      }))
    } : {})
  });
  const extracted = extract(payload);
  return {
    ...extracted,
    provider: 'gemini',
    model: env.GEMINI_MODEL,
    interactionId: payload.id ?? interactionId
  };
}

export async function streamGeminiResponse(turns: ChatTurn[], onText: (text: string) => void) {
  assertConfigured();
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY!
    },
    body: JSON.stringify({
      model: env.GEMINI_MODEL,
      input: interactionInput(turns),
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    throw new ApiError(502, 'AI_PROVIDER_ERROR', 'The MAX AI provider could not start the stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as { type?: string; delta?: { type?: string; text?: string } };
        if (event.type !== 'step.delta' || event.delta?.type !== 'text') continue;
        const text = event.delta.text ?? '';
        if (text) {
          fullText += text;
          onText(text);
        }
      } catch {
        continue;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());

  if (!fullText.trim()) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'The MAX AI provider returned no response');
  return { text: fullText, provider: 'gemini', model: env.GEMINI_MODEL };
}
