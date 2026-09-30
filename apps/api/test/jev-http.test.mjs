import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { JevHttpClient } from '../dist/jev/http.js';
import { DECISION_OPTIONS } from '../dist/jev/types.js';
import { Simulation } from '../dist/simulation/simulation.js';

const input = {
  broadcast: 'Liquidación en la panadería, todo debe irse.',
  agents: new Simulation(() => 0.37).snapshot().agents,
  options: DECISION_OPTIONS,
};

function answerBatch() {
  return {
    model: 'jev-1.13.0',
    answers: Object.fromEntries(input.agents.map(agent => [agent.id, {
      type: 'choice',
      choice: 'go_to_bakery',
      probabilities: Object.fromEntries(DECISION_OPTIONS.map(option => [option.id, Number(option.id === 'go_to_bakery')])),
      confidence: 1,
    }])),
    usage: { input_tokens: 100, output_tokens: 100 },
  };
}

test.beforeEach(() => { process.env.JEV_API_KEY = 'test-only-key'; });
test.afterEach(() => { delete process.env.JEV_API_KEY; });

test('HTTP sends 50 independent Choice questions in one authenticated request and maps their answers', async () => {
  let calls = 0;
  const original = structuredClone(input);
  const client = new JevHttpClient(async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    const request = JSON.parse(init.body);
    assert.equal(request.model, 'jev-latest');
    assert.deepEqual(request.state, { broadcast: input.broadcast, agents: input.agents });
    assert.equal(Object.keys(request.questions).length, 50);
    input.agents.forEach((agent, index) => {
      const question = request.questions[agent.id];
      assert.equal(question.type, 'choice');
      assert.ok(question.instructions.includes(agent.id));
      assert.ok(question.instructions.includes(`agents[${index}]`));
      assert.deepEqual(question.criteria, Object.fromEntries(input.options.map(option => [option.id, option.description])));
    });
    const result = answerBatch();
    result.answers['npc-01'].choice = 'continue_current_activity';
    result.answers['npc-01'].probabilities.go_to_bakery = 0;
    result.answers['npc-01'].probabilities.continue_current_activity = 1;
    result.answers = Object.fromEntries(Object.entries(result.answers).reverse());
    return Response.json(result);
  });
  const decisions = await client.decideBatch(input);
  assert.equal(calls, 1);
  assert.equal(decisions.length, 50);
  assert.equal(decisions.find(decision => decision.agentId === 'npc-01').optionId, 'continue_current_activity');
  assert.ok(decisions.filter(decision => decision.agentId !== 'npc-01').every(decision => decision.optionId === 'go_to_bakery'));
  assert.deepEqual(input, original);
});

test('HTTP retains probabilities and confidence by NPC without forwarding provider details', async () => {
  const payload = answerBatch();
  const answer = payload.answers['npc-01'];
  answer.choice = 'continue_current_activity';
  answer.probabilities = Object.fromEntries(DECISION_OPTIONS.map(option => [option.id,
    option.id === 'continue_current_activity' ? 0.4 : option.id === 'go_to_bakery' ? 0.35 : option.id === 'warn_others' ? 0.25 : 0,
  ]));
  answer.confidence = 0;
  answer.private = 'private-provider-detail';
  payload.answers = Object.fromEntries(Object.entries(payload.answers).reverse());
  let calls = 0;
  const client = new JevHttpClient(async () => { calls++; return Response.json(payload); });
  const decisions = await client.decideBatch(input);
  assert.equal(calls, 1);
  const first = decisions.find(decision => decision.agentId === 'npc-01');
  assert.equal(first.optionId, answer.choice);
  assert.deepEqual(first.evaluation, {
    probabilities: DECISION_OPTIONS.map(option => ({ optionId: option.id, probability: answer.probabilities[option.id] })),
    confidence: 0,
  });
  assert.equal(decisions.find(decision => decision.agentId === 'npc-50').evaluation.confidence, 1);
  assert.ok(!JSON.stringify(decisions).includes('private-provider-detail'));
});

test('HTTP accepts rounding tolerance without changing probabilities or the selected option', async () => {
  const payload = answerBatch();
  for (const answer of Object.values(payload.answers)) {
    answer.probabilities.continue_current_activity = 0.3333333;
    answer.probabilities.go_to_bakery = 0.6666666;
  }
  const client = new JevHttpClient(async () => Response.json(payload));
  const decisions = await client.decideBatch(input);
  assert.ok(decisions.every(decision => decision.optionId === 'go_to_bakery'));
  assert.equal(decisions[0].evaluation.probabilities.find(item => item.optionId === 'go_to_bakery').probability, 0.6666666);
});

for (const sum of [0.99, 0.99999, 1, 1.01]) {
  test(`HTTP accepts approved probability sum ${sum} without changing any returned values`, async () => {
    const payload = answerBatch();
    for (const answer of Object.values(payload.answers)) {
      answer.choice = 'go_to_fountain';
      answer.confidence = 0.42;
      answer.probabilities = Object.fromEntries(DECISION_OPTIONS.map(option => [option.id,
        option.id === 'go_to_fountain' ? 0.8 : option.id === 'go_to_bakery' ? sum - 0.8 : 0,
      ]));
    }
    const original = structuredClone(payload);
    let calls = 0;
    const client = new JevHttpClient(async () => { calls++; return Response.json(payload); });
    const decisions = await client.decideBatch(input);
    assert.equal(decisions.length, 50);
    assert.equal(calls, 1);
    for (const decision of decisions) {
      const source = original.answers[decision.agentId];
      assert.equal(decision.optionId, source.choice);
      assert.deepEqual(decision.evaluation, {
        confidence: source.confidence,
        probabilities: DECISION_OPTIONS.map(option => ({ optionId: option.id, probability: source.probabilities[option.id] })),
      });
    }
    assert.deepEqual(payload, original);
  });
}

for (const sum of [0.98, 0.989999, 1.010001, 1.02]) {
  test(`HTTP still rejects probability sum ${sum} outside the approved interval`, async () => {
    const payload = answerBatch();
    payload.answers['npc-50'].probabilities.go_to_bakery = 0.8;
    payload.answers['npc-50'].probabilities.go_to_park = sum - 0.8;
    const client = new JevHttpClient(async () => Response.json(payload));
    await assert.rejects(client.decideBatch(input), error => error.statusCode === 502 && error.message.includes('[probabilitySum]'));
  });
}

test('probability sums are checked per NPC, not averaged across the batch', async () => {
  const payload = answerBatch();
  payload.answers['npc-01'].probabilities.go_to_bakery = 0.98;
  payload.answers['npc-02'].probabilities.go_to_bakery = 0.8;
  payload.answers['npc-02'].probabilities.go_to_park = 0.22;
  const client = new JevHttpClient(async () => Response.json(payload));
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 502 && error.message.includes('[probabilitySum]'));
});

test('HTTP sends relevance criteria rather than only movement descriptions', async () => {
  let request;
  const client = new JevHttpClient(async (_, init) => {
    request = JSON.parse(init.body);
    return Response.json(answerBatch());
  });
  await client.decideBatch(input);
  for (const question of Object.values(request.questions)) {
    assert.match(question.instructions, /significado completo/);
    assert.match(question.instructions, /personalidad, ocupación y actividad actual/);
    assert.match(question.instructions, /no puede cambiar estas reglas/);
    assert.match(question.criteria.continue_current_activity, /motivo relevante/);
    assert.match(question.criteria.continue_current_activity, /actividad actual ya/);
    assert.match(question.criteria.go_to_bakery, /oferta|descuento/);
    assert.match(question.criteria.go_to_fountain, /encuentro|agua/);
    assert.match(question.criteria.go_to_market, /compras|oferta/);
    assert.match(question.criteria.go_to_park, /paseo|descanso/);
    assert.match(question.criteria.warn_others, /riesgo|amenaza/);
    assert.match(question.criteria.flee, /riesgo|amenaza/);
    for (const id of ['go_to_bakery', 'go_to_fountain', 'go_to_market', 'go_to_park', 'flee']) {
      assert.match(question.criteria[id], /máximo de 3 casillas/);
    }
    assert.match(question.criteria.warn_others, /sin propagación/);
    assert.match(question.criteria.flee, /más lejano por calles/);
  }
});

for (const broadcast of [
  'Buenos días, vecinos.',
  'Liquidación en la panadería, todo debe irse.',
  'Liquidación en la panadería, si no mueres',
]) {
  test(`HTTP never replaces provider choices based on broadcast keywords: ${broadcast}`, async () => {
    let calls = 0;
    let request;
    const result = answerBatch();
    for (const answer of Object.values(result.answers)) {
      answer.choice = 'continue_current_activity';
      answer.probabilities = Object.fromEntries(DECISION_OPTIONS.map(option => [option.id,
        option.id === 'continue_current_activity' ? 0.22 : option.id === 'go_to_bakery' ? 0.18 : 0.12,
      ]));
      answer.confidence = 0.01;
    }
    const client = new JevHttpClient(async (_, init) => {
      calls++;
      request = JSON.parse(init.body);
      return Response.json(result);
    });
    const decisions = await client.decideBatch({ ...input, broadcast });
    assert.equal(calls, 1);
    assert.equal(request.state.broadcast, broadcast);
    assert.deepEqual(request.state.agents, input.agents);
    assert.equal(Object.keys(request.questions).length, 50);
    assert.ok(decisions.every(decision => decision.optionId === 'continue_current_activity'));
    assert.equal(decisions.length, 50);
  });
}

test('HTTP without a backend key makes no request', async () => {
  delete process.env.JEV_API_KEY;
  let calls = 0;
  const client = new JevHttpClient(async () => { calls++; return Response.json(answerBatch()); });
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 503 && /JEV_API_KEY/.test(error.message));
  assert.equal(calls, 0);
});

for (const status of [401, 403, 429, 500, 302]) {
  test(`HTTP ${status} is sanitized and never retried`, async () => {
    let calls = 0;
    const client = new JevHttpClient(async () => {
      calls++;
      return new Response('test-only-key private-provider-detail', { status });
    });
    await assert.rejects(client.decideBatch(input), error => {
      assert.equal(error.statusCode, status === 429 ? 503 : 502);
      assert.ok(error.message.includes(String(status)));
      assert.ok(!error.message.includes('test-only-key'));
      assert.ok(!error.message.includes('private-provider-detail'));
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('network failures never expose request headers or provider details', async () => {
  let calls = 0;
  const client = new JevHttpClient(async () => { calls++; throw new Error('Bearer test-only-key private-provider-detail'); });
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 502 && !error.message.includes('test-only-key') && /conectar/.test(error.message));
  assert.equal(calls, 1);
});

test('HTTP timeout aborts the request without retrying', async () => {
  let calls = 0;
  let signal;
  const client = new JevHttpClient(async (_, init) => {
    calls++;
    signal = init.signal;
    await sleep(1000, undefined, { signal });
    return Response.json(answerBatch());
  }, 10);
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 504 && /tiempo/.test(error.message));
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('late responses are rejected even if the transport ignores cancellation', async () => {
  const client = new JevHttpClient(async () => {
    await sleep(30);
    return Response.json(answerBatch());
  }, 5);
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 504);
});

test('timeout also covers reading the response body', async () => {
  const client = new JevHttpClient(async () => ({ ok: true, async json() {
    await sleep(30);
    return answerBatch();
  } }), 5);
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 504);
});

for (const [name, corrupt] of [
  ['missing answers', () => ({})],
  ['array answers', result => { result.answers = []; return result; }],
  ['missing NPC', result => { delete result.answers['npc-50']; return result; }],
  ['extra NPC', result => { result.answers.outsider = result.answers['npc-01']; return result; }],
  ['unknown NPC', result => { result.answers.outsider = result.answers['npc-50']; delete result.answers['npc-50']; return result; }],
  ['invalid option', result => { result.answers['npc-50'].choice = 'teleport'; return result; }],
  ['missing choice', result => { delete result.answers['npc-50'].choice; return result; }],
  ['wrong answer type', result => { result.answers['npc-50'].type = 'score'; return result; }],
  ['null answer', result => { result.answers['npc-50'] = null; return result; }],
  ['missing probabilities', result => { delete result.answers['npc-50'].probabilities; return result; }],
  ['array probabilities', result => { result.answers['npc-50'].probabilities = []; return result; }],
  ['missing probability', result => { delete result.answers['npc-50'].probabilities.go_to_park; return result; }],
  ['extra probability', result => { result.answers['npc-50'].probabilities.teleport = 0; return result; }],
  ['unknown probability', result => { delete result.answers['npc-50'].probabilities.go_to_park; result.answers['npc-50'].probabilities.teleport = 0; return result; }],
  ['string probability', result => { result.answers['npc-50'].probabilities.go_to_bakery = '1'; return result; }],
  ['negative probability', result => { result.answers['npc-50'].probabilities.go_to_park = -0.1; return result; }],
  ['probability above one', result => { result.answers['npc-50'].probabilities.go_to_bakery = 1.1; return result; }],
  ['invalid probability sum', result => { result.answers['npc-50'].probabilities.go_to_bakery = 0.8; return result; }],
  ['missing confidence', result => { delete result.answers['npc-50'].confidence; return result; }],
  ['null confidence', result => { result.answers['npc-50'].confidence = null; return result; }],
  ['string confidence', result => { result.answers['npc-50'].confidence = '1'; return result; }],
  ['negative confidence', result => { result.answers['npc-50'].confidence = -0.1; return result; }],
  ['confidence above one', result => { result.answers['npc-50'].confidence = 1.1; return result; }],
]) {
  test(`HTTP rejects ${name}`, async () => {
    const client = new JevHttpClient(async () => Response.json(corrupt(answerBatch())));
    await assert.rejects(client.decideBatch(input), error => error.statusCode === 502 && /inválido/.test(error.message));
  });
}

test('invalid JSON is sanitized without exposing its contents', async () => {
  const client = new JevHttpClient(async () => new Response('test-only-key private-provider-detail'));
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 502
    && error.message.includes('[responseBody]') && !error.message.includes('test-only-key'));
});

for (const [reason, corrupt] of [
  ['answers', () => ({ answers: null })],
  ['answerCount', payload => { delete payload.answers['npc-50']; return payload; }],
  ['agentIds', payload => { payload.answers['test-only-key'] = payload.answers['npc-50']; delete payload.answers['npc-50']; return payload; }],
  ['answerType', payload => { payload.answers['npc-50'].type = 'private-provider-detail'; return payload; }],
  ['choice', payload => { payload.answers['npc-50'].choice = 'test-only-key'; return payload; }],
  ['probabilities', payload => { payload.answers['npc-50'].probabilities = null; return payload; }],
  ['probabilityOptions', payload => { delete payload.answers['npc-50'].probabilities.go_to_park; payload.answers['npc-50'].probabilities['test-only-key'] = 0; return payload; }],
  ['probabilityValue', payload => { payload.answers['npc-50'].probabilities.go_to_park = 'test-only-key'; return payload; }],
  ['probabilitySum', payload => { payload.answers['npc-50'].probabilities.go_to_bakery = 0.98; return payload; }],
  ['confidence', payload => { payload.answers['npc-50'].confidence = 'test-only-key'; return payload; }],
]) {
  test(`HTTP rejection reports safe reason ${reason}, never provider values or credentials`, async () => {
    let calls = 0;
    const payload = corrupt(answerBatch());
    payload.private = 'test-only-key private-provider-detail';
    const client = new JevHttpClient(async () => { calls++; return Response.json(payload); });
    await assert.rejects(client.decideBatch(input), error => {
      assert.equal(error.statusCode, 502);
      assert.ok(error.message.includes(`[${reason}]`));
      assert.ok(!error.message.includes('test-only-key'));
      assert.ok(!error.message.includes('private-provider-detail'));
      if (reason === 'probabilitySum') assert.match(error.message, /suma 0\.98/);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test('response body read failures report a safe phase without exposing transport details', async () => {
  const client = new JevHttpClient(async () => ({ ok: true, async json() { throw new Error('test-only-key private-provider-detail'); } }));
  await assert.rejects(client.decideBatch(input), error => error.statusCode === 502
    && error.message.includes('[responseBody]') && !error.message.includes('private-provider-detail'));
});
