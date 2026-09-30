import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import { Simulation } from '../dist/simulation/simulation.js';
import { createVirtualSensors, observeSensors } from '../dist/sensors/virtual-sensors.js';
import { adaptSensorReadings } from '../dist/sensors/iot-agent.js';

class TrackedSimulation extends Simulation {
  reads = 0;
  steps = 0;
  snapshot() { this.reads++; return super.snapshot(); }
  step() { super.step(); this.steps++; }
}

async function setup(t, initialTicks = 0) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1790000000000 });
  const request = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider call'); });
  const decideBatch = t.mock.fn(() => { throw new Error('Sensors must not call Jev'); });
  const simulation = new TrackedSimulation(() => 0.37);
  for (let i = 0; i < initialTicks; i++) simulation.step();
  const app = createApp({ simulation, mode: 'http', client: { decideBatch } });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    assert.equal(request.mock.callCount(), 0);
    assert.equal(decideBatch.mock.callCount(), 0);
  });
  await app.ready();
  async function connect() {
    const messages = [];
    const socket = await app.injectWS('/ws', {}, { onInit(ws) {
      ws.on('message', data => messages.push(JSON.parse(data.toString())));
    } });
    sockets.push(socket);
    return { socket, messages };
  }
  return { app, simulation, connect };
}

async function advance(t, milliseconds = 500) {
  t.mock.timers.tick(milliseconds);
  await new Promise(resolve => setImmediate(resolve));
}

function assertCoherent(message, map) {
  const expected = adaptSensorReadings(observeSensors(createVirtualSensors(map), message));
  assert.deepEqual(message.sensors, expected);
  assert.equal(message.sensors.entities.length, 6);
  assert.equal(message.sensors.tick, message.tick);
  assert.equal(message.sensors.serverTime, message.serverTime);
  assert.ok(message.sensors.entities.reduce((sum, entity) => sum + entity.peopleCount.value, 0) <= 50);
}

test('GET /sensors starts with six coherent observations, including at a nonzero initial tick', async t => {
  const { app, simulation, connect } = await setup(t, 3);
  const response = await app.inject({ method: 'GET', url: '/sensors' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const batch = response.json();
  assert.equal(batch.tick, 3);
  assert.equal(batch.simulated, true);
  assert.equal(batch.entities.length, 6);
  assert.equal(simulation.reads, 1);
  const { messages } = await connect();
  assert.equal(messages[0].type, 'init');
  assertCoherent(messages[0], simulation.map);
  assert.deepEqual(messages[0].sensors, batch);
  assert.deepEqual(messages[0].sensorMarkers, createVirtualSensors(simulation.map).map(({ id, name, position }) => ({ id, name, position })));
  assert.equal(simulation.reads, 1);
});

test('GETs and connections read the broker without generating extra observations between ticks', async t => {
  const { app, simulation, connect } = await setup(t);
  const initial = (await app.inject({ method: 'GET', url: '/sensors' })).json();
  for (let i = 0; i < 3; i++) {
    await advance(t, 100);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/sensors' })).json(), initial);
    assert.deepEqual((await connect()).messages[0].sensors, initial);
  }
  assert.equal(simulation.steps, 0);
  assert.equal(simulation.reads, 1);
  await advance(t, 200);
  const next = (await app.inject({ method: 'GET', url: '/sensors' })).json();
  assert.equal(next.tick, initial.tick + 1);
  assert.equal(next.serverTime, initial.serverTime + 500);
  assert.equal(simulation.steps, 1);
  assert.equal(simulation.reads, 2);
});

test('all six broker entities and all WebSocket clients share each authoritative tick and date', async t => {
  const { app, simulation, connect } = await setup(t);
  const a = await connect();
  const b = await connect();
  assert.deepEqual(a.messages[0], b.messages[0]);
  for (let tick = 1; tick <= 5; tick++) {
    await advance(t);
    const current = a.messages.at(-1);
    assert.equal(current.type, 'tick');
    assert.equal(current.tick, tick);
    assertCoherent(current, simulation.map);
    assert.deepEqual(current, b.messages.at(-1));
    assert.deepEqual((await app.inject({ method: 'GET', url: '/sensors' })).json(), current.sensors);
    assert.equal(simulation.reads, tick + 1);
  }
});

test('disconnect keeps the old observation; reconnect replaces it with the latest complete batch', async t => {
  const { app, simulation, connect } = await setup(t);
  const old = await connect();
  await advance(t);
  const oldBatch = structuredClone(old.messages.at(-1).sensors);
  old.socket.terminate();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 3; i++) await advance(t);
  assert.deepEqual(old.messages.at(-1).sensors, oldBatch);
  const fresh = await connect();
  assert.equal(fresh.messages[0].type, 'init');
  assert.equal(fresh.messages[0].tick, 4);
  assertCoherent(fresh.messages[0], simulation.map);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/sensors' })).json(), fresh.messages[0].sensors);
  assert.ok(fresh.messages[0].sensors.serverTime > oldBatch.serverTime);
  assert.equal(simulation.reads, 5);
  await advance(t);
  assertCoherent(fresh.messages.at(-1), simulation.map);
});

test('fresh app initialization contains only its own initial observation, not another town batch', async t => {
  const { app, simulation, connect } = await setup(t);
  assert.equal(simulation.steps, 0);
  assert.equal((await app.inject({ method: 'GET', url: '/sensors' })).json().tick, 0);
  assertCoherent((await connect()).messages[0], simulation.map);
});

test('sensor API is read-only and ignores attempts to supply counts or authoritative positions', async t => {
  const { app, simulation } = await setup(t);
  const before = (await app.inject({ method: 'GET', url: '/sensors' })).json();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await app.inject({ method, url: '/sensors', payload: { peopleCount: 50, agents: [] } });
    assert.equal(response.statusCode, 404);
  }
  assert.deepEqual((await app.inject({ method: 'GET', url: '/sensors?peopleCount=50' })).json(), before);
  assert.equal(simulation.reads, 1);
});

test('sensor ticks, queries and reconnections do not change activities, routes or invoke Jev', async t => {
  const { app, simulation, connect } = await setup(t);
  const control = new Simulation(() => 0.37);
  const actions = ['go_to_bakery', 'go_to_fountain', 'go_to_market', 'go_to_park', 'flee', 'warn_others', 'continue_current_activity'];
  const decisions = control.snapshot().agents.map((agent, index) => ({ agentId: agent.id, optionId: actions[index % actions.length] }));
  simulation.applyDecisions(decisions);
  control.applyDecisions(decisions);
  const viewer = await connect();
  for (let tick = 1; tick <= 80; tick++) {
    await advance(t);
    control.step();
    const current = viewer.messages.at(-1);
    assert.deepEqual(current.agents, control.snapshot().agents);
    assertCoherent(current, simulation.map);
    if (tick % 20 === 0) {
      assert.deepEqual((await app.inject({ method: 'GET', url: '/sensors' })).json(), current.sensors);
      const extra = await connect();
      assert.deepEqual(extra.messages[0].sensors, current.sensors);
      extra.socket.terminate();
    }
  }
});
