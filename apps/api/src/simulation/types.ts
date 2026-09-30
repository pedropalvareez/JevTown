import type { SensorBatch } from '../sensors/iot-agent.js';
import type { SensorMarker } from '../sensors/virtual-sensors.js';

export interface Position {
  x: number;
  y: number;
}

export type Tile = 'street' | 'grass' | 'building';

export interface AgentState {
  id: string;
  name: string;
  occupation: string;
  position: Position;
  currentAction: string;
  targetPosition: Position | null;
  personality: string;
}

export interface TownMap {
  width: number;
  height: number;
  tiles: Tile[][];
  districts: { id: string; name: string; labelPosition: Position }[];
  pois: { id: 'bakery' | 'fountain' | 'market' | 'park'; position: Position }[];
  buildings: { x: number; y: number; width: number; depth: number; height: number; color: number }[];
}

export interface Snapshot {
  tick: number;
  serverTime: number;
  agents: AgentState[];
}

export type ServerMessage = (
  | { type: 'init'; map: TownMap; tickMs: number; sensorMarkers: SensorMarker[] }
  | { type: 'tick' }
) & Snapshot & { sensors: SensorBatch };
