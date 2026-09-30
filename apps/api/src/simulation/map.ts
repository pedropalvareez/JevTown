import type { Tile, TownMap } from './types.js';

export function createTownMap(): TownMap {
  const avenues = new Set([3, 11, 19, 27, 35]);
  const tiles: Tile[][] = Array.from({ length: 40 }, (_, y) =>
    Array.from({ length: 40 }, (_, x) => avenues.has(x) || avenues.has(y) ? 'street' : 'grass'),
  );
  const buildings: TownMap['buildings'] = [];
  const colors = [0xfff5d9, 0xf1e8c6, 0xf8f1d8, 0xeae4c8];

  for (const blockY of [4, 12, 20, 28]) {
    for (const blockX of [4, 12, 20, 28]) {
      if ((blockX === 12 && blockY === 28) || (blockX === 28 && blockY === 12) || (blockX === 20 && blockY === 20)) continue;
      for (const offsetY of [0, 4]) {
        for (const offsetX of [0, 4]) {
          const x = blockX + offsetX;
          const y = blockY + offsetY;
          const index = buildings.length;
          const building = { x, y, width: x === 12 && y === 12 ? 3 : 2, depth: 2, height: 19 + (index % 3) * 5, color: colors[index % colors.length] };
          buildings.push(building);
          for (let dy = 0; dy < building.depth; dy++) {
            for (let dx = 0; dx < building.width; dx++) tiles[y + dy][x + dx] = 'building';
          }
        }
      }
    }
  }

  return {
    width: 40,
    height: 40,
    tiles,
    buildings,
    districts: [
      { id: 'northwest', name: 'Barrio del Olmo', labelPosition: { x: 7, y: 2 } },
      { id: 'northeast', name: 'Las Terrazas', labelPosition: { x: 30, y: 2 } },
      { id: 'center', name: 'Centro', labelPosition: { x: 22, y: 17 } },
      { id: 'southwest', name: 'Los Jardines', labelPosition: { x: 6, y: 32 } },
      { id: 'southeast', name: 'Barrio del Sol', labelPosition: { x: 30, y: 33 } },
    ],
    pois: [
      { id: 'bakery', position: { x: 11, y: 11 } },
      { id: 'fountain', position: { x: 19, y: 19 } },
      { id: 'market', position: { x: 27, y: 11 } },
      { id: 'park', position: { x: 11, y: 27 } },
    ],
  };
}
