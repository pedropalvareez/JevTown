import assert from 'node:assert/strict';
import test from 'node:test';
import { findPath } from '../dist/simulation/pathfinding.js';

const grid = (rows) => rows.map(row => [...row].map(value => value === '.' ? 'street' : 'building'));

function verifyPath(tiles, path, start, goal) {
  assert.deepEqual(path[0], start);
  assert.deepEqual(path.at(-1), goal);
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    assert.equal(tiles[point.y][point.x], 'street');
    if (i > 0) assert.equal(Math.abs(point.x - path[i - 1].x) + Math.abs(point.y - path[i - 1].y), 1);
  }
}

test('A* finds the shortest route around buildings with no diagonal steps', () => {
  const tiles = grid(['.....', '.###.', '.....']);
  const start = { x: 0, y: 1 };
  const goal = { x: 4, y: 1 };
  const path = findPath(tiles, start, goal);
  verifyPath(tiles, path, start, goal);
  assert.equal(path.length, 7);
});

test('A* returns no route for disconnected, blocked or invalid endpoints', () => {
  const tiles = grid(['.#.', '.#.', '.#.']);
  assert.deepEqual(findPath(tiles, { x: 0, y: 0 }, { x: 2, y: 0 }), []);
  assert.deepEqual(findPath(tiles, { x: 1, y: 0 }, { x: 0, y: 0 }), []);
  assert.deepEqual(findPath(tiles, { x: 0, y: 0 }, { x: 1, y: 0 }), []);
  assert.deepEqual(findPath(tiles, { x: -1, y: 0 }, { x: 0, y: 0 }), []);
  assert.deepEqual(findPath(tiles, { x: 0, y: 0 }, { x: 3, y: 0 }), []);
  assert.deepEqual(findPath(tiles, { x: 0.5, y: 0 }, { x: 0, y: 0 }), []);
  assert.deepEqual(findPath([], { x: 0, y: 0 }, { x: 0, y: 0 }), []);
});

test('A* handles a destination equal to the start', () => {
  assert.deepEqual(findPath(grid(['.']), { x: 0, y: 0 }, { x: 0, y: 0 }), [{ x: 0, y: 0 }]);
});

test('A* never traverses grass', () => {
  assert.deepEqual(findPath([['street', 'grass', 'street']], { x: 0, y: 0 }, { x: 2, y: 0 }), []);
});
