import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/jwt-payload.type';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Access token is required');
    }

    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });
      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }
      request.user = {
        id: payload.sub,
        roleKey: payload.roleKey,
        permissions: payload.permissions,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return undefined;
    }
    return authHeader.slice('Bearer '.length).trim();
  }
}
