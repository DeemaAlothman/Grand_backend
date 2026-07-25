import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import storageConfig from './config/storage.config';
import jwtConfig from './config/jwt.config';
import mailConfig from './config/mail.config';
import { validationSchema } from './config/validation.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { buildLoggerOptions } from './infrastructure/observability/logger.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AttributesModule } from './modules/attributes/attributes.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    JwtModule.register({ global: true }),
    DatabaseModule,
    MailModule,
    AuditModule,
    HealthModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    AttributesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
