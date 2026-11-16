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

type GroqToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type GroqMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: GroqToolCall[];
  tool_call_id?: string;
};
type GroqState = { messages: GroqMessage[]; model: string; updatedAt: number };
type ProviderPayload = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqToolCall[] }; delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
  error?: { message?: string };
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

const groqStates = new Map<string, GroqState>();
const STATE_TTL_MS = 5 * 60 * 1000;

function pruneGroqStates() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [id, state] of groqStates) if (state.updatedAt < cutoff) groqStates.delete(id);
}

function selectedProvider() {
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  if (env.GROQ_API_KEY) return 'groq';
  return 'gemini';
}

function assertConfigured() {
  const provider = selectedProvider();
  if (provider === 'openrouter' && !env.OPENROUTER_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'OpenRouter is not configured');
  }
  if (provider === 'groq' && !env.GROQ_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Groq is not configured');
  }
  if (provider === 'gemini' && !env.GEMINI_API_KEY) {
    throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Configure OPENROUTER_API_KEY (recommended), GROQ_API_KEY, or GEMINI_API_KEY');
  }
}

function groqMessages(turns: ChatTurn[], systemInstruction?: string): GroqMessage[] {
  const messages: GroqMessage[] = turns.map((turn) => ({
    role: turn.role === 'user' ? 'user' : 'assistant',
    content: turn.content
  }));
  if (!systemInstruction) return messages;

  // Groq recommends putting GPT-OSS instructions in user content rather than
  // using a system role. Keep conversation history intact and attach the
  // current MAX instructions to the latest user turn.
  const model = selectedProvider() === 'openrouter' ? env.OPENROUTER_MODEL : env.GROQ_MODEL;
  if (model.startsWith('openai/gpt-oss-')) {
    let latestUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { latestUserIndex = i; break; }
    }
    if (latestUserIndex >= 0) {
      const userContent = messages[latestUserIndex].content ?? '';
      messages[latestUserIndex].content = `MAX assistant instructions:\n${systemInstruction}\n\nUser request:\n${userContent}`;
    } else {
      messages.push({ role: 'user', content: systemInstruction });
    }
    return messages;
  }

  return [{ role: 'system', content: systemInstruction }, ...messages];
}

function groqTools(functions: GeminiFunctionDeclaration[]) {
  return functions.map((item) => ({
    type: 'function',
    function: {
      name: item.name,
      description: item.description,
      parameters: item.parameters
    }
  }));
}

function parseGroqToolCalls(calls: GroqToolCall[] | undefined): GeminiFunctionCall[] {
  return (calls ?? []).map((call) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(502, 'AI_INVALID_TOOL_ARGUMENTS', 'AI provider returned invalid tool arguments');
    }
    return { id: call.id, name: call.function.name, args };
  });
}

function groqError(status: number, message: string) {
  return new ApiError(502, 'AI_PROVIDER_ERROR', `AI provider request failed (${status}): ${message.slice(0, 400) || 'provider error'}`);
}

async function groqRequest(messages: GroqMessage[], functions: GeminiFunctionDeclaration[], stream = false) {
  assertConfigured();
  const provider = selectedProvider();
  const isOpenRouter = provider === 'openrouter';
  const model = isOpenRouter ? env.OPENROUTER_MODEL : env.GROQ_MODEL;
  const apiKey = isOpenRouter ? env.OPENROUTER_API_KEY : env.GROQ_API_KEY;
  const response = await fetch(isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(isOpenRouter ? { 'HTTP-Referer': 'https://max-ai.name.ng', 'X-Title': 'MAX AI' } : {}),
      ...(stream ? { accept: 'text/event-stream' } : {})
    },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      messages,
      ...(functions.length ? { tools: groqTools(functions), tool_choice: 'auto' } : {}),
      ...(!isOpenRouter && model.startsWith('openai/gpt-oss-') ? { include_reasoning: false } : {}),
      ...(stream ? { stream: true } : {}),
      temperature: 0.3,
      max_tokens: 4096
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw groqError(response.status, body);
  }
  return response;
}

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

async function runGroq(turns: ChatTurn[], functions: GeminiFunctionDeclaration[], systemInstruction?: string) {
  const messages = groqMessages(turns, systemInstruction);
  const response = await groqRequest(messages, functions);
  const payload = await response.json() as ProviderPayload;
  const message = payload.choices?.[0]?.message;
  if (!message) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'AI provider returned no response');
  const functionCalls = parseGroqToolCalls(message.tool_calls);
  pruneGroqStates();
  const interactionId = crypto.randomUUID();
  const stateMessages: GroqMessage[] = [...messages, {
    role: 'assistant',
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {})
  }];
  groqStates.set(interactionId, { messages: stateMessages, model: payload.model ?? (selectedProvider() === 'openrouter' ? env.OPENROUTER_MODEL : env.GROQ_MODEL), updatedAt: Date.now() });
  return {
    text: message.content?.trim() ?? '',
    functionCalls,
    provider: selectedProvider(),
    model: payload.model ?? (selectedProvider() === 'openrouter' ? env.OPENROUTER_MODEL : env.GROQ_MODEL),
    interactionId
  };
}

async function continueGroq(
  interactionId: string,
  functionResults: FunctionResult[],
  functions: GeminiFunctionDeclaration[]
) {
  pruneGroqStates();
  const previous = groqStates.get(interactionId);
  if (!previous) throw new ApiError(409, 'AI_CONTINUATION_EXPIRED', 'The Groq tool session expired. Please retry your request.');
  const messages: GroqMessage[] = [
    ...previous.messages,
    ...functionResults.map((item): GroqMessage => ({
      role: 'tool',
      tool_call_id: item.callId,
      content: JSON.stringify(item.result)
    }))
  ];
  const response = await groqRequest(messages, functions);
  const payload = await response.json() as ProviderPayload;
  const message = payload.choices?.[0]?.message;
  if (!message) throw new ApiError(502, 'AI_EMPTY_RESPONSE', 'AI provider returned no response after the tool call');
  const functionCalls = parseGroqToolCalls(message.tool_calls);
  groqStates.delete(interactionId);
  const nextId = crypto.randomUUID();
  messages.push({
    role: 'assistant',
    content: message.content ?? null,
    ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {})
  });
  groqStates.set(nextId, { messages, model: payload.model ?? previous.model, updatedAt: Date.now() });
  return {
    text: message.content?.trim() ?? '',
    functionCalls,
    provider: 'groq',
    model: payload.model ?? previous.model,
    interactionId: nextId
  };
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
  if (selectedProvider() === 'groq') return runGroq(turns, functions, systemInstruction);
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
  if (selectedProvider() === 'groq') return continueGroq(interactionId, functionResults, functions);
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

async function streamGroq(
  messages: GroqMessage[],
  functions: GeminiFunctionDeclaration[],
  onText: (text: string) => void
): Promise<StreamResult & { provider: string; model: string }> {
  const response = await groqRequest(messages, functions, true);
  if (!response.body) throw new ApiError(502, 'AI_STREAM_UNAVAILABLE', 'AI provider did not provide a response stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, GroqToolCall>();
  let buffer = '';
  let fullText = '';
  let finishReason: string | null = null;

  const consume = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let event: ProviderPayload;
      try { event = JSON.parse(raw) as ProviderPayload; } catch { continue; }
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      for (const delta of choice.delta?.tool_calls ?? []) {
        let call = toolCalls.get(delta.index);
        if (!call) {
          call = { id: delta.id ?? '', type: 'function', function: { name: '', arguments: '' } };
          toolCalls.set(delta.index, call);
        }
        if (delta.id) call.id = delta.id;
        if (delta.function?.name) call.function.name += delta.function.name;
        if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
      }
      const text = choice.delta?.content ?? '';
      if (text) { fullText += text; onText(text); }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());
  // Flush a final SSE data line even when the provider closes without a trailing newline.
  if (buffer.trim()) {
    const finalLine = buffer;
    buffer = '';
    consume(`${finalLine}\n`);
  }
  let calls = [...toolCalls.values()];
  let functionCalls = parseGroqToolCalls(calls);

  // Some provider streams can close without delivering a content/tool delta.
  // Retry that turn once as a regular completion before surfacing an empty
  // response to the client. This preserves the same model, prompt and tools.
  if (!fullText.trim() && !functionCalls.length) {
    const fallbackResponse = await groqRequest(messages, functions, false);
    const fallbackPayload = await fallbackResponse.json() as ProviderPayload;
    const fallbackChoice = fallbackPayload.choices?.[0];
    const fallbackMessage = fallbackChoice?.message;
    if (fallbackChoice?.finish_reason) finishReason = fallbackChoice.finish_reason;
    if (fallbackMessage) {
      const fallbackText = fallbackMessage.content ?? '';
      if (fallbackText.trim()) {
        fullText = fallbackText;
        onText(fallbackText);
      }
      calls = fallbackMessage.tool_calls ?? [];
      functionCalls = parseGroqToolCalls(calls);
    }
  }

  const interactionId = crypto.randomUUID();
  pruneGroqStates();
  const assistantMessage: GroqMessage = {
    role: 'assistant',
    content: fullText || null,
    ...(calls.length ? { tool_calls: calls } : {})
  };
  groqStates.set(interactionId, {
    messages: [...messages, assistantMessage],
    model: selectedProvider() === 'openrouter' ? env.OPENROUTER_MODEL : env.GROQ_MODEL,
    updatedAt: Date.now()
  });
  if (!fullText.trim() && !functionCalls.length) {
    throw new ApiError(502, 'AI_EMPTY_RESPONSE', `AI provider stream ended without a response${finishReason ? ` (${finishReason})` : ''}`);
  }
  return { text: fullText, functionCalls, interactionId, status: finishReason, provider: selectedProvider(), model: selectedProvider() === 'openrouter' ? env.OPENROUTER_MODEL : env.GROQ_MODEL };
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
        let args = '';
        if (typeof event.step.arguments === 'string') args = event.step.arguments;
        else if (event.step.arguments && typeof event.step.arguments === 'object') args = JSON.stringify(event.step.arguments);
        calls.set(event.index, { id: event.step.call_id ?? event.step.id ?? crypto.randomUUID(), name: event.step.name, arguments: args });
      } else if (eventType === 'step.delta' && typeof event.index === 'number' && event.delta) {
        if (event.delta.type === 'text') {
          const text = event.delta.text ?? '';
          if (text) { fullText += text; onText(text); }
        } else if (event.delta.type === 'arguments_delta' || event.delta.type === 'arguments') {
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
  if (selectedProvider() === 'groq') {
    return streamGroq(groqMessages(turns, systemInstruction), functions, onText);
  }
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
  if (selectedProvider() === 'groq') {
    pruneGroqStates();
    const previous = groqStates.get(interactionId);
    if (!previous) throw new ApiError(409, 'AI_CONTINUATION_EXPIRED', 'The Groq tool session expired. Please retry your request.');
    const messages: GroqMessage[] = [
      ...previous.messages,
      ...functionResults.map((item): GroqMessage => ({
        role: 'tool', tool_call_id: item.callId, content: JSON.stringify(item.result)
      }))
    ];
    const result = await streamGroq(messages, functions, onText);
    groqStates.delete(interactionId);
    return result;
  }
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
