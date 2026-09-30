import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { Simulation, TICK_MS } from './simulation/simulation.js';
import type { ServerMessage } from './simulation/types.js';
import { createVirtualSensors, observeSensors } from './sensors/virtual-sensors.js';
import { adaptSensorReadings } from './sensors/iot-agent.js';
import { MockContextBroker } from './sensors/context-broker.js';
import { selectJevClient } from './jev/client.js';
import { JevHttpError } from './jev/http.js';
import { DECISION_OPTIONS, type BroadcastResult, type JevClient, type JevStatus } from './jev/types.js';

export function createApp(options: { simulation?: Simulation; client?: JevClient; mode?: JevStatus['mode'] } = {}) {
  const app = Fastify({ logger: true });

  app.register(websocket, { options: { maxPayload: 1024 } });
  app.register(async (server) => {
    const simulation = options.simulation ?? new Simulation();
    const sensors = createVirtualSensors(simulation.map);
    const sensorMarkers = sensors.map(({ id, name, position }) => ({ id, name, position }));
    let publishedSnapshot = simulation.snapshot();
    const broker = new MockContextBroker(adaptSensorReadings(observeSensors(sensors, publishedSnapshot)));
    const selected = selectJevClient(options.mode);
    const client = options.client ?? selected.client;
    let timer: ReturnType<typeof setInterval> | undefined;
    let processing = false;
    let closing = false;

    server.get('/healthz', async () => ({ status: 'ok', service: 'jev-town-api' }));
    server.get('/sensors', async (_request, reply) => reply.header('Cache-Control', 'no-store').send(broker.snapshot()));
    server.get('/jev', async (): Promise<JevStatus> => ({ mode: selected.mode, available: client !== null }));
    server.post<{ Body: unknown }>('/broadcast', { bodyLimit: 16384 }, async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object' || !('broadcast' in body) || Object.keys(body).length !== 1
        || typeof body.broadcast !== 'string' || !body.broadcast.trim() || body.broadcast.length > 2000) {
        return reply.code(400).send({ error: 'Envía únicamente un broadcast de entre 1 y 2000 caracteres, no vacío.' });
      }
      if (!client) return reply.code(503).send({ error: 'Jev HTTP no disponible: falta JEV_API_KEY en el backend. No se ha usado el mock.' });
      if (closing) return reply.code(503).send({ error: 'El pueblo se está cerrando. No se aplicó el broadcast.' });
      if (processing) return reply.code(409).send({ error: 'Ya hay un broadcast en curso. Espera a que termine.' });
      processing = true;
      try {
        const snapshot = simulation.snapshot();
        const started = performance.now();
        const decisions = await client.decideBatch({
          broadcast: body.broadcast.trim(),
          agents: snapshot.agents,
          options: DECISION_OPTIONS.map(option => ({ ...option })),
        });
        const latencyMs = Math.round((performance.now() - started) * 10) / 10;
        if (closing) return reply.code(503).send({ error: 'El pueblo se está cerrando. No se aplicó el broadcast.' });
        simulation.applyDecisions(decisions);
        const result: BroadcastResult = {
          mode: selected.mode,
          latencyMs,
          total: decisions.length,
          distribution: DECISION_OPTIONS.map(option => ({
            optionId: option.id,
            count: decisions.filter(decision => decision.optionId === option.id).length,
          })),
          trace: {
            id: request.id,
            broadcast: body.broadcast.trim(),
            snapshotTick: snapshot.tick,
            snapshotTime: snapshot.serverTime,
            decisions: decisions.map(decision => ({
              agentId: decision.agentId,
              optionId: decision.optionId,
              activityBefore: snapshot.agents.find(agent => agent.id === decision.agentId)!.currentAction,
              evaluation: selected.mode === 'http' ? decision.evaluation ?? null : null,
            })),
          },
        };
        return result;
      } catch (error) {
        if (error instanceof JevHttpError) return reply.code(error.statusCode).send({ error: error.message });
        return reply.code(502).send({ error: 'No se pudo obtener un lote de decisiones válido. No se aplicó ningún resultado; puedes reintentar.' });
      } finally {
        processing = false;
      }
    });
    server.post('/wander', async (_request, reply) => {
      if (closing) return reply.code(503).send({ error: 'El pueblo se está cerrando. No se reanudó el paseo.' });
      if (processing) return reply.code(409).send({ error: 'Hay un broadcast en curso. Espera a que termine.' });
      simulation.resumeWandering();
      return reply.code(204).send();
    });
    server.get('/ws', { websocket: true }, socket => {
      const message: ServerMessage = {
        type: 'init', map: simulation.map, tickMs: TICK_MS, sensorMarkers,
        ...publishedSnapshot, sensors: broker.snapshot(),
      };
      socket.send(JSON.stringify(message));
    });

    server.addHook('onReady', async () => {
      timer = setInterval(() => {
        simulation.step();
        publishedSnapshot = simulation.snapshot();
        broker.publish(adaptSensorReadings(observeSensors(sensors, publishedSnapshot)));
        const message: ServerMessage = { type: 'tick', ...publishedSnapshot, sensors: broker.snapshot() };
        const payload = JSON.stringify(message);
        for (const socket of server.websocketServer.clients) {
          if (socket.readyState === socket.OPEN && socket.bufferedAmount < 65536) socket.send(payload);
        }
      }, TICK_MS);
    });
    server.addHook('preClose', async () => {
      closing = true;
      clearInterval(timer);
    });
  });

  return app;
}
