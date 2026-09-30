import type { AgentState } from '../simulation/types.js';
import type { Decision, DecisionOption } from './types.js';

export function validateDecisions(value: unknown, agents: AgentState[], options: DecisionOption[]): asserts value is Decision[] {
  const ids = new Set(agents.map(agent => agent.id));
  const allowed = new Set<string>(options.map(option => option.id));
  if (!Array.isArray(value) || value.length !== ids.size) throw new Error('Lote de decisiones inválido: falta o sobra algún agente.');
  const seen = new Set<string>();
  for (const decision of value) {
    if (!decision || typeof decision !== 'object' || typeof decision.agentId !== 'string'
      || !ids.has(decision.agentId) || seen.has(decision.agentId) || !allowed.has(decision.optionId)) {
      throw new Error('Lote de decisiones inválido: ID duplicado, desconocido u opción no permitida.');
    }
    seen.add(decision.agentId);
  }
}
