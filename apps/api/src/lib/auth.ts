import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { OrgRole } from '@signage/shared';
import { getEnv } from '../env';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface UserJwtPayload {
  sub: string;
  email: string;
}

export function signUserToken(payload: UserJwtPayload): string {
  const env = getEnv();
  return jwt.sign({ email: payload.email }, env.JWT_SECRET, {
    subject: payload.sub,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyUserToken(token: string): UserJwtPayload | null {
  try {
    const decoded = jwt.verify(token, getEnv().JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) return null;
    return { sub: decoded.sub, email: (decoded as jwt.JwtPayload).email as string };
  } catch {
    return null;
  }
}

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/** True when `actual` grants at least the privileges of `required`. */
export function roleSatisfies(actual: OrgRole, required: OrgRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
