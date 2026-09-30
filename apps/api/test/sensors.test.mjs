import assert from 'node:assert/strict';
import test from 'node:test';
import { createTownMap } from '../dist/simulation/map.js';
import { Simulation } from '../dist/simulation/simulation.js';
import { createVirtualSensors, observeSensors } from '../dist/sensors/virtual-sensors.js';
import { adaptSensorReadings } from '../dist/sensors/iot-agent.js';
import { MockContextBroker } from '../dist/sensors/context-broker.js';

const map = createTownMap();
const sensors = createVirtualSensors(map);
const ids = ['bakery', 'fountain', 'market', 'park', 'west-crossing', 'east-crossing']
  .map(id => `urn:ngsi-ld:CrowdFlowObserved:jev-town:${id}`);

function snapshot(positions, tick = 0) {
  return {
    tick,
    serverTime: 1790000000000 + tick * 500,
    agents: positions.map((position, i) => ({
      id: `npc-${i}`, name: `NPC ${i}`, occupation: 'Test', personality: 'Test',
      position, currentAction: 'go_to_market', targetPosition: { x: 27, y: 11 },
    })),
  };
}

function batch(positions, tick = 0) {
  return adaptSensorReadings(observeSensors(sensors, snapshot(positions, tick)));
}

const counts = readings => readings.entities.map(entity => entity.peopleCount.value);

test('six virtual sensors have stable IDs and use authoritative POIs plus street crossings', () => {
  assert.deepEqual(sensors.map(sensor => sensor.id), ids);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(createVirtualSensors(createTownMap()), sensors);
  assert.deepEqual(sensors.map(sensor => sensor.position), [
    ...map.pois.map(poi => poi.position), { x: 3, y: 19 }, { x: 35, y: 19 },
  ]);
  assert.deepEqual(sensors.map(sensor => sensor.name), ['Panadería', 'Fuente', 'Mercado', 'Parque', 'Cruce oeste', 'Cruce este']);
  assert.ok(sensors.every(sensor => map.tiles[sensor.position.y][sensor.position.x] === 'street'));
  const changed = structuredClone(map);
  changed.pois[0].position = { x: 11, y: 3 };
  assert.deepEqual(createVirtualSensors(changed)[0].position, changed.pois[0].position);
  assert.deepEqual(map, createTownMap());
});

test('six coverage zones contain only streets within Manhattan three and never overlap', () => {
  const covered = new Set();
  for (const sensor of sensors) {
    const expected = [];
    map.tiles.forEach((row, y) => row.forEach((tile, x) => {
      if (tile === 'street' && Math.abs(x - sensor.position.x) + Math.abs(y - sensor.position.y) <= 3) expected.push(`${x},${y}`);
    }));
    assert.equal(sensor.tiles.size, 13);
    assert.deepEqual([...sensor.tiles], expected);
    for (const tile of sensor.tiles) {
      assert.ok(!covered.has(tile));
      covered.add(tile);
    }
  }
  assert.equal(covered.size, 78);
});

test('known positions give exact instantaneous counts, not target-based readings', () => {
  const observed = batch([
    { x: 11, y: 11 }, { x: 14, y: 11 }, { x: 19, y: 19 },
    { x: 11, y: 27 }, { x: 35, y: 16 }, { x: 0, y: 3 },
  ]);
  assert.deepEqual(counts(observed), [2, 1, 0, 1, 0, 1]);
});

for (const [index, sensor] of sensors.entries()) {
  test(`${sensor.name}: distance three is included, four and non-streets excluded`, () => {
    const { x, y } = sensor.position;
    const included = snapshot([{ x: x + 3, y }, { x: x - 3, y }, { x, y: y + 3 }, { x, y: y - 3 }]);
    assert.equal(observeSensors(sensors, included).readings[index].peopleCount, 4);
    const excluded = snapshot([{ x: x + 4, y }, { x, y: y + 4 }, { x: x + 1, y: y + 1 }]);
    assert.equal(observeSensors(sensors, excluded).readings[index].peopleCount, 0);
  });
}

test('distinct NPCs sharing a tile count separately; one NPC never counts twice in a zone', () => {
  const input = snapshot([{ x: 11, y: 11 }, { x: 11, y: 11 }]);
  input.agents.push(structuredClone(input.agents[0]));
  assert.deepEqual(counts(adaptSensorReadings(observeSensors(sensors, input))), [2, 0, 0, 0, 0, 0]);
});

test('entry, continued presence and exit replace occupancy rather than accumulating people', () => {
  const broker = new MockContextBroker(batch([{ x: 7, y: 11 }]));
  assert.deepEqual(counts(broker.snapshot()), [0, 0, 0, 0, 0, 0]);
  for (const [tick, x, expected] of [[1, 8, 1], [2, 11, 1], [3, 15, 0]]) {
    broker.publish(batch([{ x, y: 11 }], tick));
    assert.deepEqual(counts(broker.snapshot()), [expected, 0, 0, 0, 0, 0]);
  }
});

test('empty zones and people outside all coverage publish all six zero readings', () => {
  for (const positions of [[], [{ x: 0, y: 3 }, { x: 19, y: 0 }]]) {
    const observed = batch(positions);
    assert.equal(observed.entities.length, 6);
    assert.deepEqual(counts(observed), [0, 0, 0, 0, 0, 0]);
  }
});

test('NGSI-LD observations use official terms, stable IDs and the same snapshot instant', () => {
  const observed = batch([{ x: 11, y: 11 }], 7);
  const instant = new Date(observed.serverTime).toISOString();
  assert.equal(observed.simulated, true);
  assert.equal(observed.tick, 7);
  assert.deepEqual(observed.entities.map(entity => entity.id), ids);
  for (const [index, entity] of observed.entities.entries()) {
    assert.equal(entity.type, 'CrowdFlowObserved');
    assert.deepEqual(entity.name, { type: 'Property', value: sensors[index].name });
    assert.match(entity.description.value, /SIMULADO/);
    assert.deepEqual(entity.dateObserved, { type: 'Property', value: { '@type': 'DateTime', '@value': instant } });
    assert.equal(entity.peopleCount.type, 'Property');
    assert.equal(entity.peopleCount.observedAt, instant);
    assert.ok(Number.isInteger(entity.peopleCount.value) && entity.peopleCount.value >= 0);
    assert.equal(entity['@context'].CrowdFlowObserved, 'https://smartdatamodels.org/dataModel.Transportation/CrowdFlowObserved');
    assert.equal(entity['@context'].peopleCount, 'https://smartdatamodels.org/dataModel.Transportation/peopleCount');
    assert.equal(entity['@context'].dateObserved, 'https://smartdatamodels.org/dateObserved');
    assert.equal(entity['@context'].Property, 'https://uri.etsi.org/ngsi-ld/Property');
    assert.equal(entity['@context'].DateTime, 'https://uri.etsi.org/ngsi-ld/DateTime');
    assert.equal(entity['@context'].value, 'https://uri.etsi.org/ngsi-ld/hasValue');
    for (const absent of ['occupancy', 'location', 'position', 'radius', 'tick', 'simulated']) assert.ok(!(absent in entity));
  }
});

test('broker atomically replaces the latest six observations and protects its stored batch', () => {
  const initial = batch([{ x: 11, y: 11 }]);
  const expectedInitial = structuredClone(initial);
  const broker = new MockContextBroker(initial);
  initial.entities[0].peopleCount.value = 99;
  assert.deepEqual(broker.snapshot(), expectedInitial);
  const returned = broker.snapshot();
  returned.entities.pop();
  returned.entities[0].peopleCount.value = 88;
  assert.deepEqual(broker.snapshot(), expectedInitial);
  const next = batch([{ x: 19, y: 19 }], 1);
  broker.publish(next);
  assert.deepEqual(broker.snapshot(), next);
  next.entities[1].peopleCount.value = 77;
  assert.deepEqual(counts(broker.snapshot()), [0, 1, 0, 0, 0, 0]);
  assert.equal(broker.snapshot().entities.length, 6);
  broker.publish(batch([], 1));
  broker.publish(batch([], 0));
  assert.deepEqual(counts(broker.snapshot()), [0, 1, 0, 0, 0, 0]);
});

test('coverage sum never exceeds fifty across real movement and includes fifty on one tile', () => {
  const simulation = new Simulation(() => 0.37);
  for (let i = 0; i < 100; i++) {
    const state = simulation.snapshot();
    const observed = adaptSensorReadings(observeSensors(sensors, state));
    const total = counts(observed).reduce((sum, count) => sum + count, 0);
    const covered = state.agents.filter(agent => sensors.some(sensor => sensor.tiles.has(`${agent.position.x},${agent.position.y}`))).length;
    assert.equal(total, covered);
    assert.ok(total <= 50);
    simulation.step();
  }
  assert.deepEqual(counts(batch(Array.from({ length: 50 }, () => ({ x: 11, y: 11 })))), [50, 0, 0, 0, 0, 0]);
});

test('counting never mutates snapshots, consumes randomness, calls Jev or changes routes and activities', t => {
  const request = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider call'); });
  let randomCalls = 0;
  const observed = new Simulation(() => { randomCalls++; return 0.37; });
  const control = new Simulation(() => 0.37);
  const actions = ['go_to_bakery', 'go_to_fountain', 'go_to_market', 'go_to_park', 'flee', 'warn_others', 'continue_current_activity'];
  const decisions = observed.snapshot().agents.map((agent, index) => ({ agentId: agent.id, optionId: actions[index % actions.length] }));
  observed.applyDecisions(decisions);
  control.applyDecisions(decisions);
  for (let tick = 0; tick < 100; tick++) {
    const state = observed.snapshot();
    const before = structuredClone(state);
    const callsBefore = randomCalls;
    adaptSensorReadings(observeSensors(sensors, state));
    assert.equal(randomCalls, callsBefore);
    assert.deepEqual(state, before);
    assert.deepEqual(state.agents, control.snapshot().agents);
    observed.step();
    control.step();
  }
  assert.equal(request.mock.callCount(), 0);
});
