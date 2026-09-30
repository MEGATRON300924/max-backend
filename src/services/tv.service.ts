import { generateGeminiResponse } from './ai.service.js';
import { searchWeb } from './browser.service.js';

export async function tvSearch(query: string) {
  const result = await searchWeb(query + ' TV movie show streaming content');
  return result;
}

export async function tvAssistant(request: string, context?: Record<string, unknown>) {
  const prompt = [
    'You are MAX TV, the TV-focused assistant inside the MAX AI Ecosystem.',
    'Help the user discover movies, shows, channels, games, music and TV-related information.',
    'Do not claim that MAX has controlled a TV or launched content unless a real device tool reports success.',
    context ? 'Current TV context: ' + JSON.stringify(context) : '',
    'User request: ' + request
  ].filter(Boolean).join('\n');
  return generateGeminiResponse([{ role: 'user', content: prompt }]);
}
