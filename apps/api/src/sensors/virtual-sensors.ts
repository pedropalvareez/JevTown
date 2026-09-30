import type { Position, Snapshot, TownMap } from '../simulation/types.js';

export interface SensorMarker {
  id: string;
  name: string;
  position: Position;
}

export interface VirtualSensor extends SensorMarker {
  tiles: Set<string>;
}

export interface SensorReadings {
  tick: number;
  serverTime: number;
  readings: { id: string; name: string; peopleCount: number }[];
}

export function createVirtualSensors(map: TownMap): VirtualSensor[] {
  const names = { bakery: 'Panadería', fountain: 'Fuente', market: 'Mercado', park: 'Parque' };
  const centers = [
    ...map.pois.map(poi => ({ ...poi, name: names[poi.id] })),
    { id: 'west-crossing', name: 'Cruce oeste', position: { x: 3, y: 19 } },
    { id: 'east-crossing', name: 'Cruce este', position: { x: 35, y: 19 } },
  ];
  return centers.map(({ id, name, position }) => ({
    id: `urn:ngsi-ld:CrowdFlowObserved:jev-town:${id}`,
    name,
    position: { ...position },
    tiles: new Set(map.tiles.flatMap((row, y) => row.flatMap((tile, x) =>
      tile === 'street' && Math.abs(x - position.x) + Math.abs(y - position.y) <= 3 ? [`${x},${y}`] : [],
    ))),
  }));
}

export function observeSensors(sensors: readonly VirtualSensor[], snapshot: Snapshot): SensorReadings {
  return {
    tick: snapshot.tick,
    serverTime: snapshot.serverTime,
    readings: sensors.map(sensor => ({
      id: sensor.id,
      name: sensor.name,
      peopleCount: new Set(snapshot.agents.filter(agent => sensor.tiles.has(`${agent.position.x},${agent.position.y}`))
        .map(agent => agent.id)).size,
    })),
  };
}
