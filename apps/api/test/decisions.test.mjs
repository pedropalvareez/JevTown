import assert from 'node:assert/strict';
import test from 'node:test';
import { Simulation } from '../dist/simulation/simulation.js';
import { findPath } from '../dist/simulation/pathfinding.js';

const makeSimulation = () => new Simulation(() => 0.37);
const batch = (simulation, optionId) => simulation.snapshot().agents.map(agent => ({ agentId: agent.id, optionId }));
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function stepOnStreets(simulation) {
  const previous = simulation.snapshot();
  simulation.step();
  const current = simulation.snapshot();
  current.agents.forEach((agent, i) => {
    assert.equal(simulation.map.tiles[agent.position.y][agent.position.x], 'street');
    assert.ok(distance(agent.position, previous.agents[i].position) <= 1);
  });
  return current;
}

test('every agent keeps walking near bakery after arrival without losing its decision', () => {
  const simulation = makeSimulation();
  const destination = simulation.map.pois.find(poi => poi.id === 'bakery').position;
  simulation.applyDecisions(batch(simulation, 'go_to_bakery'));
  for (let i = 0; i < 80; i++) stepOnStreets(simulation);
  let previous = simulation.snapshot();
  for (let i = 0; i < 100; i++) {
    const current = stepOnStreets(simulation);
    current.agents.forEach((agent, index) => {
      assert.equal(distance(agent.position, previous.agents[index].position), 1);
      assert.ok(distance(agent.position, destination) <= 3);
      assert.equal(agent.currentAction, 'go_to_bakery');
      assert.deepEqual(agent.targetPosition, destination);
    });
    previous = current;
  }
});

test('continue_current_activity preserves agent state, routes and normal wandering', () => {
  const simulation = makeSimulation();
  const control = makeSimulation();
  for (let i = 0; i < 5; i++) { simulation.step(); control.step(); }
  const before = simulation.snapshot().agents;
  simulation.applyDecisions(batch(simulation, 'continue_current_activity'));
  assert.deepEqual(simulation.snapshot().agents, before);
  for (let i = 0; i < 100; i++) {
    simulation.step();
    control.step();
    assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  }
});

for (const poiId of ['bakery', 'fountain', 'market', 'park']) {
  test(`go_to_${poiId} uses current positions, reaches the POI and keeps walking nearby`, () => {
    const simulation = makeSimulation();
    const decisions = batch(simulation, `go_to_${poiId}`);
    for (let i = 0; i < 4; i++) simulation.step();
    const before = simulation.snapshot();
    const destination = simulation.map.pois.find(poi => poi.id === poiId).position;
    const routes = before.agents.map(agent => findPath(simulation.map.tiles, agent.position, destination).slice(1));
    simulation.applyDecisions(decisions);
    assert.deepEqual(simulation.snapshot().agents.map(agent => agent.position), before.agents.map(agent => agent.position));
    let previous = before;
    for (let tick = 0; tick < 100; tick++) {
      const current = stepOnStreets(simulation);
      current.agents.forEach((agent, index) => {
        if (tick < routes[index].length) assert.deepEqual(agent.position, routes[index][tick]);
        else assert.ok(distance(agent.position, destination) <= 3);
        assert.equal(distance(agent.position, previous.agents[index].position), 1);
        assert.equal(agent.currentAction, `go_to_${poiId}`);
        assert.deepEqual(agent.targetPosition, destination);
      });
      previous = current;
    }
    simulation.applyDecisions(batch(simulation, 'continue_current_activity'));
    assert.deepEqual(simulation.snapshot().agents, previous.agents);
    assert.ok(stepOnStreets(simulation).agents.every(agent => agent.currentAction === `go_to_${poiId}` && distance(agent.position, destination) <= 3));
  });
}

test('continue_current_activity preserves an in-progress POI route', () => {
  const simulation = makeSimulation();
  const control = makeSimulation();
  simulation.applyDecisions(batch(simulation, 'go_to_bakery'));
  control.applyDecisions(batch(control, 'go_to_bakery'));
  for (let i = 0; i < 3; i++) { simulation.step(); control.step(); }
  simulation.applyDecisions(batch(simulation, 'continue_current_activity'));
  for (let i = 0; i < 80; i++) {
    simulation.step();
    control.step();
    assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  }
});

test('continue preserves local walks and a new decision redirects them to another POI', () => {
  const simulation = makeSimulation();
  const control = makeSimulation();
  for (const town of [simulation, control]) {
    town.applyDecisions(batch(town, 'go_to_bakery'));
    for (let i = 0; i < 80; i++) town.step();
  }
  simulation.applyDecisions(batch(simulation, 'continue_current_activity'));
  for (let i = 0; i < 20; i++) {
    stepOnStreets(simulation);
    control.step();
    assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  }
  const before = simulation.snapshot();
  const destination = simulation.map.pois.find(poi => poi.id === 'market').position;
  simulation.applyDecisions(batch(simulation, 'go_to_market'));
  assert.deepEqual(simulation.snapshot().agents.map(agent => agent.position), before.agents.map(agent => agent.position));
  const arrived = new Set();
  for (let i = 0; i < 100; i++) {
    const current = stepOnStreets(simulation);
    current.agents.forEach(agent => {
      if (distance(agent.position, destination) === 0) arrived.add(agent.id);
      assert.equal(agent.currentAction, 'go_to_market');
      assert.deepEqual(agent.targetPosition, destination);
      if (arrived.has(agent.id)) assert.ok(distance(agent.position, destination) <= 3);
    });
  }
  assert.equal(arrived.size, 50);
});

test('continue preserves warning pursuit; a new destination cancels it', () => {
  const simulation = makeSimulation();
  const control = makeSimulation();
  simulation.applyDecisions(batch(simulation, 'warn_others'));
  control.applyDecisions(batch(control, 'warn_others'));
  assert.ok(simulation.snapshot().agents.some(agent => agent.targetPosition));
  simulation.applyDecisions(batch(simulation, 'continue_current_activity'));
  for (let i = 0; i < 3; i++) {
    stepOnStreets(simulation);
    control.step();
    assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  }
  simulation.applyDecisions(batch(simulation, 'go_to_bakery'));
  const destination = simulation.map.pois.find(poi => poi.id === 'bakery').position;
  for (let i = 0; i < 100; i++) stepOnStreets(simulation);
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_bakery' && distance(agent.position, destination) <= 3));
});

test('corrupt decisions are rejected atomically without changing state or routes', () => {
  const simulation = makeSimulation();
  const control = makeSimulation();
  const decisions = batch(simulation, 'go_to_bakery');
  decisions[49].optionId = 'teleport';
  assert.throws(() => simulation.applyDecisions(decisions), /decisiones/i);
  assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  for (let i = 0; i < 30; i++) {
    simulation.step();
    control.step();
    assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  }
});

test('flee selects the farthest existing POI by street route and persists after arrival', () => {
  const simulation = makeSimulation();
  const before = simulation.snapshot();
  const destinations = before.agents.map(agent => simulation.map.pois.reduce((farthest, poi) => {
    const route = findPath(simulation.map.tiles, agent.position, poi.position);
    return route.length > farthest.route.length ? { position: poi.position, route } : farthest;
  }, { position: null, route: [] }).position);
  simulation.applyDecisions(batch(simulation, 'flee'));
  simulation.snapshot().agents.forEach((agent, i) => assert.deepEqual(agent.targetPosition, destinations[i]));
  const arrived = new Set();
  let previous = before;
  for (let tick = 0; tick < 150; tick++) {
    const current = stepOnStreets(simulation);
    current.agents.forEach((agent, i) => {
      if (distance(agent.position, destinations[i]) === 0) arrived.add(agent.id);
      if (arrived.has(agent.id)) assert.ok(distance(agent.position, destinations[i]) <= 3);
      assert.equal(distance(agent.position, previous.agents[i].position), 1);
      assert.deepEqual(agent.targetPosition, destinations[i]);
      assert.equal(agent.currentAction, 'flee');
    });
    previous = current;
  }
  assert.equal(arrived.size, 50);
});

test('warn_others approaches the nearest NPC, follows their movement and does not change their decision', () => {
  const simulation = makeSimulation();
  const decisions = batch(simulation, 'go_to_park');
  simulation.applyDecisions(decisions);
  const before = simulation.snapshot();
  const observer = before.agents.find(agent => before.agents.every(other => other.id === agent.id || distance(agent.position, other.position) > 1));
  assert.ok(observer);
  const receiver = before.agents.filter(agent => agent.id !== observer.id).reduce((nearest, agent) => {
    const path = findPath(simulation.map.tiles, observer.position, agent.position);
    return !nearest || path.length < nearest.path.length ? { agent, path } : nearest;
  }, null).agent;
  const warnings = batch(simulation, 'continue_current_activity');
  warnings.find(decision => decision.agentId === observer.id).optionId = 'warn_others';
  simulation.applyDecisions(warnings);
  const applied = simulation.snapshot();
  assert.deepEqual(applied.agents.find(agent => agent.id === observer.id).targetPosition, receiver.position);
  assert.deepEqual(applied.agents.filter(agent => agent.id !== observer.id), before.agents.filter(agent => agent.id !== observer.id));
  let contacted = false;
  let receiverMoved = false;
  for (let i = 0; i < 120; i++) {
    const current = stepOnStreets(simulation);
    const warning = current.agents.find(agent => agent.id === observer.id);
    const target = current.agents.find(agent => agent.id === receiver.id);
    receiverMoved ||= distance(target.position, receiver.position) > 0;
    assert.equal(target.currentAction, 'go_to_park');
    assert.equal(warning.currentAction, 'warn_others');
    if (!warning.targetPosition) { contacted = true; break; }
  }
  assert.ok(receiverMoved);
  assert.ok(contacted);
  const stopped = simulation.snapshot().agents.find(agent => agent.id === observer.id);
  for (let i = 0; i < 10; i++) stepOnStreets(simulation);
  assert.deepEqual(simulation.snapshot().agents.find(agent => agent.id === observer.id), stopped);
  simulation.applyDecisions(batch(simulation, 'go_to_bakery'));
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_bakery'));
});

test('resumeWandering returns every agent to town-wide wandering from its current position', () => {
  const simulation = makeSimulation();
  const decisions = batch(simulation, 'go_to_bakery');
  decisions.slice(0, 10).forEach(decision => { decision.optionId = 'warn_others'; });
  decisions.slice(10, 20).forEach(decision => { decision.optionId = 'flee'; });
  simulation.applyDecisions(decisions);
  for (let i = 0; i < 60; i++) stepOnStreets(simulation);
  const before = simulation.snapshot();
  simulation.resumeWandering();
  const after = simulation.snapshot();
  after.agents.forEach((agent, index) => {
    assert.deepEqual(agent.position, before.agents[index].position);
    assert.equal(agent.currentAction, 'wandering');
    assert.equal(simulation.map.tiles[agent.targetPosition.y][agent.targetPosition.x], 'street');
    assert.notDeepEqual(agent.targetPosition, agent.position);
  });
  for (let i = 0; i < 200; i++) {
    assert.ok(stepOnStreets(simulation).agents.every(agent => agent.currentAction === 'wandering' || agent.currentAction === 'idle'));
  }
});
