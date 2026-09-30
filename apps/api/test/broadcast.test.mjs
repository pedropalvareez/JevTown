import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import { MockJevClient } from '../dist/jev/mock.js';
import { JevHttpClient } from '../dist/jev/http.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { DECISION_OPTIONS } from '../dist/jev/types.js';
import { Simulation } from '../dist/simulation/simulation.js';

const broadcast = 'Liquidación en la panadería, todo debe irse.';
const decide = (input, optionId = 'go_to_bakery') => input.agents.map(agent => ({ agentId: agent.id, optionId }));
const send = (app, text = broadcast) => app.inject({ method: 'POST', url: '/broadcast', payload: { broadcast: text } });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function setup(t, client, mode = 'mock') {
  const simulation = new Simulation(() => 0.37);
  const app = createApp({ simulation, client, mode });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
  });
  return { app, simulation, sockets };
}

test('one authoritative snapshot and one batch call; ticks and WebSocket keep moving during 600 ms', { timeout: 6000 }, async t => {
  let calls = 0;
  let captured;
  let snapshotAtCall;
  const mock = new MockJevClient(() => 0.5);
  const { app, simulation, sockets } = setup(t, { decideBatch(input) {
    calls++;
    snapshotAtCall = simulation.snapshot().agents;
    captured = structuredClone(input);
    return mock.decideBatch(input);
  } });
  await app.ready();
  const messages = [];
  const socket = await app.injectWS('/ws', {}, { onInit(ws) {
    ws.on('message', data => messages.push(JSON.parse(data.toString())));
  } });
  sockets.push(socket);
  const before = simulation.snapshot();
  const started = performance.now();
  const response = await send(app);
  const elapsed = performance.now() - started;
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  assert.deepEqual(captured.agents, snapshotAtCall);
  assert.deepEqual(captured.options, DECISION_OPTIONS);
  assert.equal(captured.agents.length, 50);
  const result = response.json();
  assert.equal(result.mode, 'mock');
  assert.equal(result.total, 50);
  assert.equal(result.distribution.reduce((sum, item) => sum + item.count, 0), 50);
  assert.equal(result.distribution.length, 7);
  assert.ok(result.latencyMs >= 590 && result.latencyMs < 2000);
  assert.ok(elapsed < 2000);
  assert.ok(simulation.snapshot().tick > before.tick);
  const during = messages.filter(message => message.type === 'tick');
  assert.ok(during.length > 0);
  assert.ok(during.some(message => message.agents.some((agent, i) => agent.position.x !== before.agents[i].position.x || agent.position.y !== before.agents[i].position.y)));
  const bakery = simulation.map.pois.find(poi => poi.id === 'bakery').position;
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_bakery'));
  assert.ok(simulation.snapshot().agents.every(agent => JSON.stringify(agent.targetPosition) === JSON.stringify(bakery)));
});

test('concurrent broadcasts return 409 without another call; next batch runs only after first settles', async t => {
  const entered = deferred();
  const finish = deferred();
  let calls = 0;
  const { app, simulation } = setup(t, { async decideBatch(input) {
    calls++;
    if (calls === 1) { entered.resolve(); await finish.promise; }
    return decide(input, calls === 1 ? 'go_to_bakery' : 'go_to_park');
  } });
  const first = send(app);
  const firstResponse = Promise.resolve(first);
  await entered.promise;
  const overlap = await send(app, 'Otro mensaje');
  assert.equal(overlap.statusCode, 409);
  assert.equal(calls, 1);
  finish.resolve();
  assert.equal((await firstResponse).statusCode, 200);
  assert.equal((await send(app)).statusCode, 200);
  assert.equal(calls, 2);
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_park'));
});

test('wander resumes free walking without calling the client and is rejected during a broadcast', async t => {
  const entered = deferred();
  const finish = deferred();
  let calls = 0;
  const { app, simulation } = setup(t, { async decideBatch(input) {
    calls++;
    entered.resolve();
    await finish.promise;
    return decide(input);
  } });
  const first = Promise.resolve(send(app));
  await entered.promise;
  const overlap = await app.inject({ method: 'POST', url: '/wander' });
  assert.equal(overlap.statusCode, 409);
  finish.resolve();
  assert.equal((await first).statusCode, 200);
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_bakery'));
  const response = await app.inject({ method: 'POST', url: '/wander' });
  assert.equal(response.statusCode, 204);
  assert.equal(calls, 1);
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'wandering'));
});

test('invalid results and provider failures apply nothing, expose no internal errors and release the lock', async t => {
  let calls = 0;
  const { app, simulation } = setup(t, { async decideBatch(input) {
    calls++;
    if (calls === 2) throw new Error('private-provider-detail');
    const decisions = decide(input);
    if (calls === 1) decisions[49].agentId = decisions[0].agentId;
    return decisions;
  } });
  const original = simulation.snapshot().agents;
  const corrupt = await send(app);
  assert.equal(corrupt.statusCode, 502);
  assert.deepEqual(simulation.snapshot().agents, original);
  const failed = await send(app);
  assert.equal(failed.statusCode, 502);
  assert.ok(!failed.body.includes('private-provider-detail'));
  assert.equal((await send(app)).statusCode, 200);
  assert.equal(calls, 3);
});

test('batch latency is measured rather than hardcoded to 600', async t => {
  const { app } = setup(t, { async decideBatch(input) { return decide(input); } });
  const response = await send(app);
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().latencyMs >= 0 && response.json().latencyMs < 500);
});

test('invalid broadcasts never call the client', async t => {
  let calls = 0;
  const { app } = setup(t, { async decideBatch(input) { calls++; return decide(input); } });
  for (const payload of [{}, { broadcast: '' }, { broadcast: '   ' }, { broadcast: 17 }, { broadcast: 'x'.repeat(2001) }]) {
    const response = await app.inject({ method: 'POST', url: '/broadcast', payload });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('browser-provided agents cannot replace authoritative state', async t => {
  let received;
  const { app } = setup(t, { async decideBatch(input) { received = input; return decide(input); } });
  const response = await app.inject({ method: 'POST', url: '/broadcast', payload: { broadcast, agents: [{ id: 'fake' }] } });
  assert.equal(response.statusCode, 400);
  assert.equal(received, undefined);
});

test('results arriving during shutdown are not applied', { timeout: 5000 }, async t => {
  const entered = deferred();
  const finish = deferred();
  const stopped = deferred();
  const { app, simulation } = setup(t, { async decideBatch(input) {
    entered.resolve();
    await finish.promise;
    return decide(input);
  } });
  app.addHook('preClose', async () => { stopped.resolve(); });
  const response = Promise.resolve(send(app));
  await entered.promise;
  const before = simulation.snapshot().agents;
  const closing = app.close();
  await stopped.promise;
  await new Promise(resolve => setImmediate(resolve));
  finish.resolve();
  assert.equal((await response).statusCode, 503);
  await closing;
  assert.deepEqual(simulation.snapshot().agents, before);
});

test('HTTP without a backend key reports unavailable with no mock fallback', async t => {
  delete process.env.JEV_API_KEY;
  const { app } = setup(t, undefined, 'http');
  const status = await app.inject({ method: 'GET', url: '/jev' });
  assert.deepEqual(status.json(), { mode: 'http', available: false });
  const response = await send(app);
  assert.equal(response.statusCode, 503);
  assert.match(response.json().error, /JEV_API_KEY/);
});

function httpAnswers(init, choice = 'go_to_bakery') {
  const request = JSON.parse(init.body);
  return Response.json({
    model: 'jev-1.13.0',
    answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, {
      type: 'choice', choice,
      probabilities: Object.fromEntries(Object.keys(request.questions[id].criteria).map(option => [option, Number(option === choice)])),
      confidence: 1,
    }])),
    usage: { input_tokens: 100, output_tokens: 100 },
  });
}

test('HTTP mode reports real decisions, keeps ticking and rejects overlapping broadcasts', { timeout: 6000 }, async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  let calls = 0;
  const entered = deferred();
  const finish = deferred();
  t.after(() => finish.resolve());
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    entered.resolve();
    await finish.promise;
    return httpAnswers(init);
  });
  const { app, simulation } = setup(t, client, 'http');
  const status = await app.inject({ method: 'GET', url: '/jev' });
  assert.deepEqual(status.json(), { mode: 'http', available: true });
  assert.ok(!status.body.includes('test-only-key'));
  const before = simulation.snapshot();
  const pending = Promise.resolve(send(app));
  await entered.promise;
  assert.equal((await send(app)).statusCode, 409);
  await sleep(550);
  assert.ok(simulation.snapshot().tick > before.tick);
  finish.resolve();
  const response = await pending;
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'http');
  assert.equal(response.json().total, 50);
  assert.equal(response.json().distribution.reduce((sum, item) => sum + item.count, 0), 50);
  assert.equal(calls, 1);
  assert.ok(!response.body.includes('test-only-key'));
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_bakery'));
});

test('HTTP broadcast exposes the submitted snapshot context and per-NPC evaluations in the same response', async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  let calls = 0;
  let sent;
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    sent = JSON.parse(init.body);
    const payload = await httpAnswers(init, 'continue_current_activity').json();
    payload.private = 'test-only-key private-provider-detail';
    payload.answers['npc-01'].probabilities.continue_current_activity = 0.6;
    payload.answers['npc-01'].probabilities.warn_others = 0.4;
    payload.answers['npc-01'].confidence = 0.42;
    payload.answers['npc-01'].reason = 'private-provider-detail';
    payload.answers = Object.fromEntries(Object.entries(payload.answers).reverse());
    simulation.step();
    return Response.json(payload);
  });
  const { app, simulation } = setup(t, client, 'http');
  const before = simulation.snapshot();
  const response = await send(app, `  ${broadcast}  `);
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  const { trace } = response.json();
  assert.equal(typeof trace.id, 'string');
  assert.ok(trace.id.length > 0);
  assert.equal(trace.broadcast, broadcast);
  assert.equal(trace.snapshotTick, before.tick);
  assert.equal(trace.snapshotTime, before.serverTime);
  assert.ok(simulation.snapshot().tick > trace.snapshotTick);
  assert.equal(trace.decisions.length, 50);
  for (const decision of trace.decisions) {
    const source = sent.state.agents.find(agent => agent.id === decision.agentId);
    assert.equal(decision.activityBefore, source.currentAction);
    assert.equal(decision.optionId, 'continue_current_activity');
    assert.equal(decision.evaluation.probabilities.length, 7);
    assert.equal(decision.evaluation.confidence, decision.agentId === 'npc-01' ? 0.42 : 1);
  }
  const first = trace.decisions.find(decision => decision.agentId === 'npc-01');
  assert.equal(first.evaluation.probabilities.find(item => item.optionId === 'warn_others').probability, 0.4);
  assert.ok(!response.body.includes('test-only-key'));
  assert.ok(!response.body.includes('private-provider-detail'));
  assert.ok(simulation.snapshot().agents.every(agent => !('evaluation' in agent)));
});

test('HTTP broadcast accepts a 0.99 sum and preserves provider choices, probabilities and confidence in the trace', async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  let calls = 0;
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    const payload = await httpAnswers(init, 'go_to_fountain').json();
    for (const answer of Object.values(payload.answers)) {
      answer.probabilities = Object.fromEntries(DECISION_OPTIONS.map(option => [option.id, option.id === 'go_to_fountain' ? 0.93 : 0.01]));
      answer.confidence = 0.8;
    }
    return Response.json(payload);
  });
  const { app, simulation } = setup(t, client, 'http');
  const response = await send(app, 'id todos a la fuente');
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  const result = response.json();
  assert.equal(result.total, 50);
  assert.equal(result.distribution.find(item => item.optionId === 'go_to_fountain').count, 50);
  for (const decision of result.trace.decisions) {
    assert.equal(decision.optionId, 'go_to_fountain');
    assert.equal(decision.evaluation.confidence, 0.8);
    assert.deepEqual(decision.evaluation.probabilities, DECISION_OPTIONS.map(option => ({ optionId: option.id, probability: option.id === 'go_to_fountain' ? 0.93 : 0.01 })));
  }
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_fountain'));
});

test('mock trace identifies decisions without fabricating provider probabilities', async t => {
  const { app } = setup(t, new MockJevClient(() => 0.37, async () => {}));
  const response = await send(app);
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.equal(result.mode, 'mock');
  assert.equal(result.trace.decisions.length, 50);
  assert.ok(result.trace.decisions.every(decision => decision.evaluation === null));
});

test('invalid HTTP probabilities apply nothing, return no partial trace and release the broadcast lock', async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  let calls = 0;
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    const payload = await httpAnswers(init).json();
    if (calls === 1) payload.answers['npc-50'].probabilities.go_to_bakery = 0.2;
    return Response.json(payload);
  });
  const { app, simulation } = setup(t, client, 'http');
  const control = new Simulation(() => 0.37);
  const response = await send(app);
  assert.equal(response.statusCode, 502);
  assert.match(response.json().error, /\[probabilitySum\]/);
  assert.match(response.json().error, /suma 0\.2/);
  assert.ok(!response.body.includes('test-only-key'));
  assert.equal(response.json().trace, undefined);
  assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  for (let i = 0; i < 3; i++) { simulation.step(); control.step(); }
  assert.deepEqual(simulation.snapshot().agents, control.snapshot().agents);
  assert.equal((await send(app)).statusCode, 200);
  assert.equal(calls, 2);
});

test('HTTP authentication failures are readable, sanitized and never applied as mock decisions', async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  const client = new JevHttpClient(async () => new Response('private-provider-detail test-only-key', { status: 401 }));
  const { app, simulation } = setup(t, client, 'http');
  const before = simulation.snapshot().agents;
  const response = await send(app);
  assert.equal(response.statusCode, 502);
  assert.match(response.json().error, /autenticación/);
  assert.ok(!response.body.includes('test-only-key'));
  assert.ok(!response.body.includes('private-provider-detail'));
  assert.deepEqual(simulation.snapshot().agents, before);
});

test('HTTP timeout applies nothing and releases the lock for a subsequent decision', async t => {
  process.env.JEV_API_KEY = 'test-only-key';
  t.after(() => { delete process.env.JEV_API_KEY; });
  let calls = 0;
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    if (calls === 1) await sleep(30);
    return httpAnswers(init, calls === 1 ? 'go_to_bakery' : 'go_to_park');
  }, 10);
  const { app, simulation } = setup(t, client, 'http');
  const before = simulation.snapshot().agents;
  assert.equal((await send(app)).statusCode, 504);
  assert.deepEqual(simulation.snapshot().agents, before);
  assert.equal((await send(app)).statusCode, 200);
  assert.equal(calls, 2);
  assert.ok(simulation.snapshot().agents.every(agent => agent.currentAction === 'go_to_park'));
});
