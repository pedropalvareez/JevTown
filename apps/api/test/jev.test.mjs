import assert from 'node:assert/strict';
import test from 'node:test';
import { MockJevClient } from '../dist/jev/mock.js';
import { JevHttpClient } from '../dist/jev/http.js';
import { selectJevClient } from '../dist/jev/client.js';
import { DECISION_OPTIONS } from '../dist/jev/types.js';
import { validateDecisions } from '../dist/jev/validation.js';
import { Simulation } from '../dist/simulation/simulation.js';

const agents = new Simulation(() => 0.4).snapshot().agents;
const input = { broadcast: 'Liquidación en la panadería, todo debe irse.', agents, options: DECISION_OPTIONS };
const valid = () => agents.map(agent => ({ agentId: agent.id, optionId: 'continue_current_activity' }));

function seededRandom() {
  let seed = 12345;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('mock waits once for 600 ms per batch and returns 50 valid decisions without mutating input', async () => {
  const waits = [];
  let release;
  const client = new MockJevClient(seededRandom(), ms => {
    waits.push(ms);
    return new Promise(resolve => { release = resolve; });
  });
  const before = structuredClone(input);
  const pending = client.decideBatch(input);
  assert.deepEqual(waits, [600]);
  release();
  const decisions = await pending;
  assert.equal(decisions.length, 50);
  validateDecisions(decisions, agents, DECISION_OPTIONS);
  assert.deepEqual(input, before);
});

test('mock is reproducible and weights bakery decisions using normalized broadcast text', async () => {
  const decide = broadcast => new MockJevClient(seededRandom(), async () => {}).decideBatch({ ...input, broadcast });
  const sale = await decide(input.broadcast);
  assert.deepEqual(sale, await decide(input.broadcast));
  assert.deepEqual(sale, await decide('LIQUIDACIÓN EN LA PANADERÍA, TODO DEBE IRSE.'));
  const neutral = await decide('Buenos días, vecinos.');
  const count = decisions => decisions.filter(decision => decision.optionId === 'go_to_bakery').length;
  assert.ok(count(sale) > count(neutral));
  assert.ok(count(sale) > 25);
});

test('mock respects the supplied options', async () => {
  const options = DECISION_OPTIONS.filter(option => option.id === 'go_to_park');
  const decisions = await new MockJevClient(seededRandom(), async () => {}).decideBatch({ ...input, options });
  assert.ok(decisions.every(decision => decision.optionId === 'go_to_park'));
});

test('mock is the default; HTTP requires a backend key and invalid modes fail', () => {
  const previous = process.env.JEV_MODE;
  try {
    delete process.env.JEV_MODE;
    delete process.env.JEV_API_KEY;
    assert.equal(selectJevClient().mode, 'mock');
    assert.ok(selectJevClient().client instanceof MockJevClient);
    process.env.JEV_MODE = 'http';
    assert.deepEqual(selectJevClient(), { mode: 'http', client: null });
    process.env.JEV_API_KEY = 'test-only-key';
    assert.equal(selectJevClient().mode, 'http');
    assert.ok(selectJevClient().client instanceof JevHttpClient);
    assert.throws(() => selectJevClient('typo'), /JEV_MODE/);
  } finally {
    delete process.env.JEV_API_KEY;
    if (previous === undefined) delete process.env.JEV_MODE;
    else process.env.JEV_MODE = previous;
  }
});

test('validation accepts exactly one allowed decision for every authoritative agent', () => {
  validateDecisions(valid().reverse(), agents, DECISION_OPTIONS);
});

for (const [name, corrupt] of [
  ['duplicate IDs', decisions => { decisions[49].agentId = decisions[0].agentId; return decisions; }],
  ['missing agent', decisions => decisions.slice(1)],
  ['extra decision', decisions => [...decisions, decisions[0]]],
  ['unknown agent', decisions => { decisions[49].agentId = 'outsider'; return decisions; }],
  ['invalid option', decisions => { decisions[49].optionId = 'teleport'; return decisions; }],
  ['missing option', decisions => { delete decisions[49].optionId; return decisions; }],
  ['null entry', decisions => { decisions[49] = null; return decisions; }],
  ['non-array result', () => ({ decisions: valid() })],
]) {
  test(`validation rejects ${name}`, () => {
    assert.throws(() => validateDecisions(corrupt(valid()), agents, DECISION_OPTIONS), /decisiones/i);
  });
}
