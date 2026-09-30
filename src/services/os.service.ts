import { env } from '../config/env.js';

export function maxOsManifest() {
  return {
    name: 'MAX OS',
    version: '1.0',
    identity: 'MAX Auth',
    brain: 'MAX AI',
    voice: env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID ? 'ElevenLabs' : null,
    services: ['home','music','cloud','browser','connect','store','studio','security','pay','voice'],
    transport: 'HTTP API',
    authentication: 'MAX Auth JWT/JWKS',
    storage: 'MAX Cloud',
    status: 'operational'
  };
}
