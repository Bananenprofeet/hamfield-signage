import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@signage/shared';
import { hashPassword, signUserToken, verifyPassword } from '../lib/auth';
import { authenticateUser } from '../plugins/auth';
import { conflict, unauthorized } from '../lib/errors';
import { serializeOrg, serializeUser } from '../lib/serializers';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${suffix}` : suffix;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app;

  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = registerSchema.parse(req.body);

      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw conflict('An account with this email already exists');

      const passwordHash = await hashPassword(body.password);
      const user = await prisma.user.create({
        data: { email: body.email, passwordHash, name: body.name },
      });
      const org = await prisma.organization.create({
        data: {
          name: body.organizationName,
          slug: slugify(body.organizationName),
          members: { create: { userId: user.id, role: 'owner' } },
        },
      });

      req.log.info({ userId: user.id, orgId: org.id }, 'auth: user registered');
      const token = signUserToken({ sub: user.id, email: user.email });
      return reply.status(201).send({
        token,
        user: serializeUser(user),
        organizations: [serializeOrg(org, 'owner')],
      });
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const body = loginSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) {
        req.log.warn({ email: body.email }, 'auth: login failed (unknown user)');
        throw unauthorized('Invalid email or password');
      }
      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) {
        req.log.warn({ userId: user.id }, 'auth: login failed (bad password)');
        throw unauthorized('Invalid email or password');
      }

      const memberships = await prisma.organizationMember.findMany({
        where: { userId: user.id, organization: { deletedAt: null } },
        include: { organization: true },
      });

      req.log.info({ userId: user.id }, 'auth: login success');
      return {
        token: signUserToken({ sub: user.id, email: user.email }),
        user: serializeUser(user),
        organizations: memberships.map((m) => serializeOrg(m.organization, m.role)),
      };
    },
  );

  app.get('/auth/me', { preHandler: authenticateUser }, async (req) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: user.id, organization: { deletedAt: null } },
      include: { organization: true },
    });
    return {
      user: serializeUser(user),
      organizations: memberships.map((m) => serializeOrg(m.organization, m.role)),
    };
  });
}
