import type { Position, Tile } from './types.js';

export function findPath(tiles: Tile[][], start: Position, goal: Position): Position[] {
  const walkable = ({ x, y }: Position) => Number.isInteger(x) && Number.isInteger(y) && tiles[y]?.[x] === 'street';
  if (!walkable(start) || !walkable(goal)) return [];

  const width = tiles[0].length;
  const key = ({ x, y }: Position) => y * width + x;
  const position = (index: number): Position => ({ x: index % width, y: Math.floor(index / width) });
  const heuristic = ({ x, y }: Position) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const startKey = key(start);
  const goalKey = key(goal);
  const open = new Set([startKey]);
  const scores = new Map([[startKey, 0]]);
  const estimates = new Map([[startKey, heuristic(start)]]);
  const parents = new Map<number, number>();

  while (open.size > 0) {
    let current = -1;
    let best = Infinity;
    for (const candidate of open) {
      const estimate = estimates.get(candidate)!;
      if (estimate < best) {
        current = candidate;
        best = estimate;
      }
    }
    if (current === goalKey) {
      const path = [position(current)];
      while (parents.has(current)) {
        current = parents.get(current)!;
        path.push(position(current));
      }
      return path.reverse();
    }
    open.delete(current);
    const { x, y } = position(current);
    for (const neighbor of [{ x: x + 1, y }, { x, y: y + 1 }, { x: x - 1, y }, { x, y: y - 1 }]) {
      if (!walkable(neighbor)) continue;
      const neighborKey = key(neighbor);
      const score = scores.get(current)! + 1;
      if (score >= (scores.get(neighborKey) ?? Infinity)) continue;
      parents.set(neighborKey, current);
      scores.set(neighborKey, score);
      estimates.set(neighborKey, score + heuristic(neighbor));
      open.add(neighborKey);
    }
  }
  return [];
}
