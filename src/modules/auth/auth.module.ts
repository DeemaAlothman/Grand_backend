import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
  exports: [TokensService],
})
export class AuthModule {}
