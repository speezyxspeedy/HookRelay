import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { loadConfig } from './src/server/config.js';
import { openDatabase } from './src/server/database/db.js';
import { RetryWorker } from './src/server/workers/retryWorker.js';
import { createApp } from './src/server/app.js';

async function startServer() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const worker = new RetryWorker(db, config);
  worker.start();

  const app = createApp(db, config, worker);

  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = config.nodeEnv === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `[HookRelay] Server running on http://0.0.0.0:${config.port} (env=${config.nodeEnv}, db=${config.dbPath})`
    );
  });

  const shutdown = () => {
    worker.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[HookRelay] Fatal startup error:', err);
  process.exit(1);
});
