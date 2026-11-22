import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { AppConfig } from '../config.js';

export function buildOpenApiSpec(config: AppConfig) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'HookRelay Webhook Delivery & Reliability API',
      version: '1.0.0',
      description:
        'Production REST API for registering webhook endpoints, ingesting events with idempotency keys, inspecting HTTP delivery attempts, managing retries, replaying Dead Letter Queue records, and querying delivery analytics.',
    },
    servers: [
      {
        url: config.appUrl || `http://localhost:${config.port}`,
        description: 'Active HookRelay Server',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Server-configured HOOKRELAY_API_KEY or claimed workspace admin key.',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Admin API key or short-lived dashboard Bearer session token.',
        },
      },
      schemas: {
        ApiError: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Request validation failed' },
                details: { type: 'array', items: { type: 'object' } },
                request_id: { type: 'string', example: 'req_a1b2c3d4e5f6' },
              },
            },
          },
        },
        CreateEndpointInput: {
          type: 'object',
          required: ['name', 'url', 'subscribed_events'],
          properties: {
            name: { type: 'string', example: 'Orders Fulfillment Service' },
            url: { type: 'string', format: 'uri', example: 'https://api.example.com/webhooks/orders' },
            description: { type: 'string', example: 'Receives real-time order lifecycle events' },
            subscribed_events: {
              type: 'array',
              items: { type: 'string' },
              example: ['order.created', 'order.cancelled'],
            },
            enabled: { type: 'boolean', default: true },
          },
        },
        CreateEventInput: {
          type: 'object',
          required: ['type', 'data'],
          properties: {
            type: { type: 'string', example: 'order.created' },
            data: {
              type: 'object',
              example: { orderId: 'ORD-1001', amount: 1499, currency: 'INR' },
            },
            idempotency_key: {
              type: 'string',
              example: 'ord-1001-created-v1',
              description:
                'Optional idempotency key. Reusing the same key with the same payload returns the existing event without duplicating deliveries.',
            },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Health check',
          security: [],
          responses: {
            '200': { description: 'Database, worker, and runtime health status' },
          },
        },
      },
      '/api/endpoints': {
        get: {
          tags: ['Endpoints'],
          summary: 'List registered webhook endpoints',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'enabled', in: 'query', schema: { type: 'boolean' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Paginated list of endpoints (secrets redacted)' } },
        },
        post: {
          tags: ['Endpoints'],
          summary: 'Register a new webhook endpoint',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateEndpointInput' } },
            },
          },
          responses: {
            '201': {
              description: 'Endpoint created; includes initial signing_secret once',
            },
            '400': { description: 'Invalid URL, blocked private network IP, or invalid event type' },
          },
        },
      },
      '/api/endpoints/{id}': {
        get: {
          tags: ['Endpoints'],
          summary: 'Get endpoint details and recent deliveries',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Endpoint detail' }, '404': { description: 'Not found' } },
        },
        patch: {
          tags: ['Endpoints'],
          summary: 'Update endpoint configuration or enabled state',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated endpoint' } },
        },
        delete: {
          tags: ['Endpoints'],
          summary: 'Delete a webhook endpoint',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Endpoint deleted' } },
        },
      },
      '/api/endpoints/{id}/test': {
        post: {
          tags: ['Endpoints'],
          summary: 'Dispatch a live test webhook immediately to an endpoint',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'Test event and real HTTP delivery result' } },
        },
      },
      '/api/endpoints/{id}/rotate-secret': {
        post: {
          tags: ['Endpoints'],
          summary: 'Rotate an endpoint HMAC signing secret',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Returns newly generated signing_secret once' } },
        },
      },
      '/api/events': {
        get: {
          tags: ['Events'],
          summary: 'List ingested events',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Paginated event list' } },
        },
        post: {
          tags: ['Events'],
          summary: 'Create an event and enqueue deliveries to matching enabled endpoints',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              schema: { type: 'string' },
              description: 'Optional idempotency key preventing duplicate event/delivery creation',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateEventInput' } },
            },
          },
          responses: {
            '201': { description: 'Event created and deliveries queued' },
            '200': { description: 'Idempotent replay returned existing event' },
            '409': { description: 'Idempotency key reused with mismatched payload' },
          },
        },
      },
      '/api/events/{id}': {
        get: {
          tags: ['Events'],
          summary: 'Get event details and associated deliveries',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Event detail and deliveries' } },
        },
      },
      '/api/events/{id}/replay': {
        post: {
          tags: ['Events'],
          summary: 'Replay an existing event to selected endpoints',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['endpoint_ids'],
                  properties: {
                    endpoint_ids: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'New replay deliveries created and queued' } },
        },
      },
      '/api/deliveries': {
        get: {
          tags: ['Deliveries'],
          summary: 'List deliveries with status, endpoint, event, and replay filters',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'endpoint_id', in: 'query', schema: { type: 'string' } },
            { name: 'event_id', in: 'query', schema: { type: 'string' } },
            { name: 'is_replay', in: 'query', schema: { type: 'boolean' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
          ],
          responses: { '200': { description: 'Paginated delivery list' } },
        },
      },
      '/api/deliveries/{id}': {
        get: {
          tags: ['Deliveries'],
          summary: 'Inspect a delivery with full request/response attempt history',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Detailed delivery record with all attempts' } },
        },
      },
      '/api/deliveries/{id}/attempts': {
        get: {
          tags: ['Deliveries'],
          summary: 'List every HTTP attempt recorded for a delivery',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Ordered list of attempts' } },
        },
      },
      '/api/deliveries/{id}/retry': {
        post: {
          tags: ['Deliveries'],
          summary: 'Manually trigger an immediate retry for a failed or retrying delivery',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Delivery queued for immediate retry' } },
        },
      },
      '/api/dead-letters': {
        get: {
          tags: ['Dead Letter Queue'],
          summary: 'List deliveries that exhausted retries or permanently failed',
          parameters: [
            { name: 'include_archived', in: 'query', schema: { type: 'boolean', default: false } },
          ],
          responses: { '200': { description: 'Paginated DLQ records' } },
        },
      },
      '/api/dead-letters/{id}/replay': {
        post: {
          tags: ['Dead Letter Queue'],
          summary: 'Create a new replay delivery from a dead-lettered record while preserving history',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '201': { description: 'New replay delivery created' } },
        },
      },
      '/api/dead-letters/{id}/archive': {
        post: {
          tags: ['Dead Letter Queue'],
          summary: 'Archive/dismiss a dead-lettered delivery without deleting attempt history',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Archived dead-letter record' } },
        },
      },
      '/api/analytics/overview': {
        get: {
          tags: ['Analytics'],
          summary: 'Database-backed dashboard metrics, endpoint health, and recent activity',
          responses: { '200': { description: 'Overview analytics payload' } },
        },
      },
      '/api/analytics/deliveries': {
        get: {
          tags: ['Analytics'],
          summary: 'Time-series success/failure rates, latency distribution, and reliability breakdowns',
          parameters: [
            { name: 'range', in: 'query', schema: { type: 'string', enum: ['24h', '7d', '30d'] } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { '200': { description: 'Delivery analytics response' } },
        },
      },
    },
  };
}

export function createOpenApiRouter(config: AppConfig): Router {
  const router = Router();
  const spec = buildOpenApiSpec(config);

  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });

  router.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'HookRelay OpenAPI Documentation',
  }));

  return router;
}
