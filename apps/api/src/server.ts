import { createApp } from './app.js';

const app = createApp();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ port: 4000, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
