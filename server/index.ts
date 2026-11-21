import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadDotEnv } from './config.js';

loadDotEnv();

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}

const app = await buildApp(config);
app.log.info({ mode: config.demoMode ? 'demo' : 'live', database: config.databasePath }, 'starting AI Desk Dashboard');

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (e) {
  app.log.error({ err: e instanceof Error ? e.message : 'listen failed' }, 'failed to start');
  process.exit(1);
}
