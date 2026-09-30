import assert from 'node:assert/strict';
import test from 'node:test';
import { createTownMap } from '../dist/simulation/map.js';
import { findPath } from '../dist/simulation/pathfinding.js';
import { Simulation, TICK_MS } from '../dist/simulation/simulation.js';

function seededRandom() {
  let seed = 12345;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('town has 40x40 tiles, five districts and four fixed reachable POIs', () => {
  const map = createTownMap();
  assert.equal(map.width, 40);
  assert.equal(map.height, 40);
  assert.equal(map.tiles.length, 40);
  assert.ok(map.tiles.every(row => row.length === 40));
  assert.equal(map.districts.length, 5);
  assert.deepEqual(map.pois.map(poi => poi.id), ['bakery', 'fountain', 'market', 'park']);
  assert.deepEqual(createTownMap(), map);
  const start = map.pois[0].position;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x] === 'street') assert.ok(findPath(map.tiles, start, { x, y }).length > 0);
    }
  }
  for (const poi of map.pois) assert.equal(map.tiles[poi.position.y][poi.position.x], 'street');
  for (const building of map.buildings) {
    for (let y = building.y; y < building.y + building.depth; y++) {
      for (let x = building.x; x < building.x + building.width; x++) assert.equal(map.tiles[y][x], 'building');
    }
  }
});

test('50 distinct NPCs retain their identity and move along streets for 500 ticks', () => {
  const simulation = new Simulation(seededRandom());
  let previous = simulation.snapshot();
  const initialIds = previous.agents.map(agent => agent.id);
  assert.equal(TICK_MS, 500);
  assert.equal(previous.agents.length, 50);
  assert.equal(new Set(initialIds).size, 50);
  assert.equal(new Set(previous.agents.map(agent => `${agent.position.x},${agent.position.y}`)).size, 50);
  const moved = new Set();

  for (let tick = 1; tick <= 500; tick++) {
    simulation.step();
    const current = simulation.snapshot();
    assert.equal(current.tick, tick);
    assert.deepEqual(current.agents.map(agent => agent.id), initialIds);
    current.agents.forEach((agent, index) => {
      const old = previous.agents[index];
      assert.equal(simulation.map.tiles[agent.position.y][agent.position.x], 'street');
      const distance = Math.abs(agent.position.x - old.position.x) + Math.abs(agent.position.y - old.position.y);
      assert.ok(distance <= 1);
      if (distance > 0) moved.add(agent.id);
      assert.ok(agent.name && agent.occupation && agent.personality && agent.currentAction);
      if (agent.targetPosition) assert.equal(simulation.map.tiles[agent.targetPosition.y][agent.targetPosition.x], 'street');
    });
    previous = current;
  }
  assert.equal(moved.size, 50);
});

test('snapshots cannot mutate the authoritative agent state', () => {
  const simulation = new Simulation(seededRandom());
  const snapshot = simulation.snapshot();
  snapshot.agents[0].position.x = -99;
  if (snapshot.agents[0].targetPosition) snapshot.agents[0].targetPosition.x = -99;
  const fresh = simulation.snapshot();
  assert.notEqual(fresh.agents[0].position.x, -99);
  assert.notEqual(fresh.agents[0].targetPosition?.x, -99);
});
