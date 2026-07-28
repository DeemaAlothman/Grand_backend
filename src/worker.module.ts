import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import storageConfig from './config/storage.config';
import jwtConfig from './config/jwt.config';
import mailConfig from './config/mail.config';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { buildLoggerOptions } from './infrastructure/observability/logger.config';
import { AuditModule } from './modules/audit/audit.module';
import { StockReleaseModule } from './jobs/stock-release/stock-release.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        storageConfig,
        jwtConfig,
        mailConfig,
      ],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        buildLoggerOptions(
          configService.get<string>('app.nodeEnv') ?? 'development',
        ),
    }),
    DatabaseModule,
    QueueModule,
    AuditModule,
    StockReleaseModule,
  ],
})
export class WorkerModule {}
