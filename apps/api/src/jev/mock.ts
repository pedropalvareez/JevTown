import { setTimeout } from 'node:timers/promises';
import type { Decision, DecisionAction, JevClient } from './types.js';

export class MockJevClient implements JevClient {
  constructor(
    private readonly random: () => number = Math.random,
    private readonly wait: (ms: number) => Promise<void> = ms => setTimeout(ms),
  ) {}

  async decideBatch(input: Parameters<JevClient['decideBatch']>[0]): Promise<Decision[]> {
    const text = input.broadcast.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const weights: Record<DecisionAction, number> = {
      continue_current_activity: 4,
      go_to_bakery: /\b(panaderia|pan|bollos)\b/.test(text) ? 24 : 1,
      go_to_fountain: /\b(fuente|agua)\b/.test(text) ? 24 : 1,
      go_to_market: /\b(mercado|puestos)\b/.test(text) ? 24 : 1,
      go_to_park: /\b(parque|jardin|paseo)\b/.test(text) ? 24 : 1,
      warn_others: /\b(avisar|aviso|peligro|incendio)\b/.test(text) ? 12 : 0.5,
      flee: /\b(huir|evacuar|evacuacion|peligro|incendio)\b/.test(text) ? 24 : 0.5,
    };
    if (!input.options.length) throw new Error('El mock necesita opciones de decisión.');
    const total = input.options.reduce((sum, option) => sum + weights[option.id], 0);
    await this.wait(600);
    return input.agents.map(agent => {
      let draw = this.random() * total;
      const selected = input.options.find(option => {
        draw -= weights[option.id];
        return draw < 0;
      }) ?? input.options[input.options.length - 1];
      return { agentId: agent.id, optionId: selected.id };
    });
  }
}
