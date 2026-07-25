import { randomUUID } from 'crypto';
import type { Params } from 'nestjs-pino';
import type { IncomingMessage } from 'http';
import type { TransportSingleOptions } from 'pino';

function resolvePrettyTransport(): TransportSingleOptions | undefined {
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { singleLine: true, colorize: true },
    };
  } catch {
    return undefined;
  }
}

export function buildLoggerOptions(nodeEnv: string): Params {
  const isProduction = nodeEnv === 'production';

  return {
    pinoHttp: {
      level: isProduction ? 'info' : 'debug',
      transport: isProduction ? undefined : resolvePrettyTransport(),
      genReqId: (req: IncomingMessage) =>
        (req.headers['x-request-id'] as string) ?? randomUUID(),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.token',
          'req.body.refreshToken',
          'req.body.currentPassword',
          'req.body.newPassword',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      autoLogging: true,
    },
  };
}
