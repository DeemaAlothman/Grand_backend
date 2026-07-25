export interface AccessTokenPayload {
  sub: string;
  roleKey: string;
  permissions: string[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export interface AuthenticatedUser {
  id: string;
  roleKey: string;
  permissions: string[];
}
