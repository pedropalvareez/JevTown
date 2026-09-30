import { MockJevClient } from './mock.js';
import { JevHttpClient } from './http.js';
import type { JevClient, JevStatus } from './types.js';

export function selectJevClient(mode = process.env.JEV_MODE ?? 'mock'): { mode: JevStatus['mode']; client: JevClient | null } {
  if (mode === 'mock') return { mode, client: new MockJevClient() };
  if (mode === 'http') return { mode, client: process.env.JEV_API_KEY?.trim() ? new JevHttpClient() : null };
  throw new Error('JEV_MODE debe ser mock o http.');
}
