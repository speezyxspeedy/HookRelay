import type { Request, Response, NextFunction } from 'express';
import type { HookRelayDB } from '../database/db.js';
import type { AppConfig } from '../config.js';
import { isRequestAuthenticated, isSetupRequired } from '../security/auth.js';
import { ApiError } from './errorHandler.js';

export function createAuthMiddleware(db: HookRelayDB, config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const apiKeyHeader = req.header('x-api-key');
    const authHeader = req.header('authorization');

    if (isRequestAuthenticated(db, config, apiKeyHeader, authHeader)) {
      next();
      return;
    }

    if (isSetupRequired(db, config)) {
      next(
        new ApiError(
          401,
          'ADMIN_SETUP_REQUIRED',
          'HookRelay admin API key has not been configured yet. Complete first-run setup or set HOOKRELAY_API_KEY.'
        )
      );
      return;
    }

    next(
      new ApiError(
        401,
        'UNAUTHORIZED',
        'Valid X-API-Key header or Authorization Bearer token is required.'
      )
    );
  };
}
