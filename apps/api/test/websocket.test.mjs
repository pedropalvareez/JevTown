import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

function connect(app) {
  const messages = [];
  let resolveTick;
  const nextTick = new Promise(resolve => { resolveTick = resolve; });
  return app.injectWS('/ws', {}, {
    onInit(socket) {
      socket.on('message', data => {
        const message = JSON.parse(data.toString());
        messages.push(message);
        if (message.type === 'tick') resolveTick(message);
      });
    },
  }).then(socket => ({ socket, messages, nextTick }));
}

test('WebSocket streams one shared simulation and reconnects with current state', { timeout: 5000 }, async (t) => {
  const app = createApp();
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.socket.terminate();
    await app.close();
  });
  await app.ready();
  const a = await connect(app);
  clients.push(a);
  const b = await connect(app);
  clients.push(b);
  const [tickA, tickB] = await Promise.all([a.nextTick, b.nextTick]);
  const init = a.messages[0];
  assert.equal(init.type, 'init');
  assert.equal(init.tickMs, 500);
  assert.equal(init.map.width, 40);
  assert.equal(init.agents.length, 50);
  assert.deepEqual(tickA, tickB);
  assert.equal(tickA.tick, init.tick + 1);
  assert.ok(tickA.agents.some((agent, i) => agent.position.x !== init.agents[i].position.x || agent.position.y !== init.agents[i].position.y));
  a.socket.terminate();
  const reconnected = await connect(app);
  clients.push(reconnected);
  await reconnected.nextTick;
  assert.ok(reconnected.messages[0].tick >= tickA.tick);
  assert.equal(reconnected.messages[0].agents.length, 50);
});
