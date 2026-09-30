import { createTownMap } from './map.js';
import { findPath } from './pathfinding.js';
import type { AgentState, Position, Snapshot } from './types.js';
import { DECISION_OPTIONS, type DecisionAction } from '../jev/types.js';
import { validateDecisions } from '../jev/validation.js';

export const TICK_MS = 500;

const names = ['Alba', 'Bruno', 'Clara', 'Diego', 'Elena', 'Felipe', 'Gloria', 'Hugo', 'Inés', 'Javier'];
const surnames = ['Ríos', 'Vega', 'Soler', 'Luna', 'Prado'];
const occupations = ['Panadera', 'Profesor', 'Florista', 'Carpintero', 'Médica', 'Cocinero', 'Artista', 'Jardinero', 'Librera', 'Músico'];
const personalities = [
  'Disfruta de las conversaciones y de conocer a sus vecinos.',
  'Prefiere la tranquilidad y los paseos sin prisa.',
  'Siente curiosidad por cualquier novedad del pueblo.',
  'Es práctico y siempre intenta ayudar a los demás.',
  'Valora la seguridad y el bienestar de su comunidad.',
];

export class Simulation {
  readonly map = createTownMap();
  private readonly streets: Position[] = [];
  private readonly agents: AgentState[];
  private readonly routes = new Map<string, Position[]>();
  private readonly warningTargets = new Map<string, AgentState>();
  private tick = 0;
  private serverTime = Date.now();

  constructor(private readonly random: () => number = Math.random) {
    this.map.tiles.forEach((row, y) => row.forEach((tile, x) => {
      if (tile === 'street') this.streets.push({ x, y });
    }));
    const starts = [...this.streets];
    for (let i = starts.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [starts[i], starts[j]] = [starts[j], starts[i]];
    }
    this.agents = Array.from({ length: 50 }, (_, i) => ({
      id: `npc-${String(i + 1).padStart(2, '0')}`,
      name: `${names[i % names.length]} ${surnames[Math.floor(i / names.length)]}`,
      occupation: occupations[i % occupations.length],
      position: { ...starts[i] },
      currentAction: 'wandering',
      targetPosition: null,
      personality: personalities[i % personalities.length],
    }));
    for (const agent of this.agents) this.chooseDestination(agent);
  }

  private chooseDestination(agent: AgentState) {
    let index = Math.floor(this.random() * this.streets.length);
    if (this.streets[index].x === agent.position.x && this.streets[index].y === agent.position.y) {
      index = (index + 1) % this.streets.length;
    }
    agent.targetPosition = { ...this.streets[index] };
    agent.currentAction = 'wandering';
    this.routes.set(agent.id, findPath(this.map.tiles, agent.position, agent.targetPosition).slice(1));
  }

  private chooseNearbyDestination(agent: AgentState) {
    const center = agent.targetPosition!;
    const nearby = this.streets.filter(position =>
      Math.abs(position.x - center.x) + Math.abs(position.y - center.y) <= 3
      && (position.x !== agent.position.x || position.y !== agent.position.y),
    );
    const destination = nearby[Math.floor(this.random() * nearby.length)];
    this.routes.set(agent.id, findPath(this.map.tiles, agent.position, destination).slice(1));
  }

  resumeWandering() {
    this.warningTargets.clear();
    for (const agent of this.agents) this.chooseDestination(agent);
  }

  applyDecisions(decisions: unknown) {
    validateDecisions(decisions, this.agents, DECISION_OPTIONS);
    const plans: { agent: AgentState; action: DecisionAction; path: Position[]; recipient?: AgentState }[] = [];
    for (const decision of decisions) {
      if (decision.optionId === 'continue_current_activity') continue;
      const agent = this.agents.find(candidate => candidate.id === decision.agentId)!;
      let path: Position[];
      let recipient: AgentState | undefined;
      if (decision.optionId === 'warn_others') {
        const nearest = this.agents.filter(candidate => candidate.id !== agent.id)
          .map(candidate => ({ agent: candidate, path: findPath(this.map.tiles, agent.position, candidate.position) }))
          .sort((a, b) => a.path.length - b.path.length)[0];
        path = nearest.path;
        recipient = nearest.agent;
      } else {
        const destinations = decision.optionId === 'flee' ? this.map.pois
          : this.map.pois.filter(poi => `go_to_${poi.id}` === decision.optionId);
        path = destinations.map(poi => findPath(this.map.tiles, agent.position, poi.position))
          .sort((a, b) => b.length - a.length)[0];
      }
      if (!path?.length) throw new Error('Lote de decisiones inválido: destino no accesible.');
      plans.push({ agent, action: decision.optionId, path, recipient });
    }
    for (const { agent, action, path, recipient } of plans) {
      agent.currentAction = action;
      this.warningTargets.delete(agent.id);
      if (recipient) {
        this.routes.set(agent.id, path.slice(1, -1));
        agent.targetPosition = path.length > 2 ? { ...recipient.position } : null;
        if (path.length > 2) this.warningTargets.set(agent.id, recipient);
      } else {
        this.routes.set(agent.id, path.slice(1));
        agent.targetPosition = { ...path[path.length - 1] };
      }
    }
  }

  private updateWarning(agent: AgentState) {
    const recipient = this.warningTargets.get(agent.id);
    if (!recipient) return;
    const distance = Math.abs(agent.position.x - recipient.position.x) + Math.abs(agent.position.y - recipient.position.y);
    if (distance <= 1) {
      this.routes.set(agent.id, []);
    } else if (agent.targetPosition?.x !== recipient.position.x || agent.targetPosition?.y !== recipient.position.y) {
      this.routes.set(agent.id, findPath(this.map.tiles, agent.position, recipient.position).slice(1, -1));
      agent.targetPosition = { ...recipient.position };
    }
  }

  step() {
    for (const agent of this.agents) {
      this.updateWarning(agent);
      const wandering = agent.currentAction === 'wandering' || agent.currentAction === 'idle';
      if (!this.routes.get(agent.id)?.length) {
        if (wandering) this.chooseDestination(agent);
        else if (agent.currentAction.startsWith('go_to_') || agent.currentAction === 'flee') this.chooseNearbyDestination(agent);
      }
      const route = this.routes.get(agent.id)!;
      const next = route.shift();
      if (next) agent.position = next;
      if (!route.length && (wandering || this.warningTargets.has(agent.id))) {
        if (wandering) agent.currentAction = 'idle';
        agent.targetPosition = null;
        this.warningTargets.delete(agent.id);
      }
    }
    this.tick++;
    this.serverTime = Date.now();
  }

  snapshot(): Snapshot {
    return {
      tick: this.tick,
      serverTime: this.serverTime,
      agents: this.agents.map(agent => ({
        ...agent,
        position: { ...agent.position },
        targetPosition: agent.targetPosition ? { ...agent.targetPosition } : null,
      })),
    };
  }
}
