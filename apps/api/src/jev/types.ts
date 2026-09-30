import type { AgentState } from '../simulation/types.js';

export type DecisionAction =
  | 'continue_current_activity'
  | 'go_to_bakery'
  | 'go_to_fountain'
  | 'go_to_market'
  | 'go_to_park'
  | 'warn_others'
  | 'flee';

export interface DecisionOption {
  id: DecisionAction;
  description: string;
}

export interface DecisionEvaluation {
  probabilities: { optionId: DecisionAction; probability: number }[];
  confidence: number;
}

export interface Decision {
  agentId: string;
  optionId: DecisionAction;
  evaluation?: DecisionEvaluation;
}

export interface JevClient {
  decideBatch(input: {
    broadcast: string;
    agents: AgentState[];
    options: DecisionOption[];
  }): Promise<Decision[]>;
}

export const DECISION_OPTIONS: DecisionOption[] = [
  { id: 'continue_current_activity', description: 'El anuncio no aporta un motivo relevante para cambiar, o la actividad actual ya responde adecuadamente al anuncio. Conservar actividad y ruta actuales; no es la opción por defecto solo por estar paseando.' },
  { id: 'go_to_bakery', description: 'Acudir si una oferta de pan, descuentos o una invitación en la panadería interesa al NPC. Una mera mención del lugar no basta; no acudir si allí se anuncia un peligro. Ir a la panadería y pasear por las calles cercanas, a un máximo de 3 casillas.' },
  { id: 'go_to_fountain', description: 'Acudir si un encuentro, una invitación o un anuncio sobre agua en la fuente interesa al NPC. Una mera mención del lugar no basta; no acudir si allí se anuncia un peligro. Ir a la fuente y pasear por las calles cercanas, a un máximo de 3 casillas.' },
  { id: 'go_to_market', description: 'Acudir si las compras, ofertas, puestos o un encuentro en el mercado interesan al NPC. Una mera mención del lugar no basta; no acudir si allí se anuncia un peligro. Ir al mercado y pasear por las calles cercanas, a un máximo de 3 casillas.' },
  { id: 'go_to_park', description: 'Acudir si un paseo, descanso, encuentro o invitación en el parque interesa al NPC. Una mera mención del lugar no basta; no acudir si allí se anuncia un peligro. Ir al parque y pasear por las calles cercanas, a un máximo de 3 casillas.' },
  { id: 'warn_others', description: 'Avisar a un vecino cuando el anuncio comunica una amenaza, un riesgo o una necesidad de ayuda y el NPC considera importante informar a otros. Acercarse al vecino más cercano por calles para avisarle, sin propagación.' },
  { id: 'flee', description: 'Priorizar la seguridad alejándose ante una amenaza o un riesgo comunicado que el NPC considera relevante. Ir al POI más lejano por calles, a velocidad normal, y pasear por las calles cercanas, a un máximo de 3 casillas.' },
];

export interface JevStatus {
  mode: 'mock' | 'http';
  available: boolean;
}

export interface BroadcastResult {
  mode: JevStatus['mode'];
  latencyMs: number;
  total: number;
  distribution: { optionId: DecisionAction; count: number }[];
  trace: {
    id: string;
    broadcast: string;
    snapshotTick: number;
    snapshotTime: number;
    decisions: {
      agentId: string;
      optionId: DecisionAction;
      activityBefore: string;
      evaluation: DecisionEvaluation | null;
    }[];
  };
}
