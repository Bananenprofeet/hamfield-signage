import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';
export { PrismaClient };

let singleton: PrismaClient | undefined;

/** Returns a lazily created shared PrismaClient. */
export function getPrisma(): PrismaClient {
  if (!singleton) {
    singleton = new PrismaClient();
  }
  return singleton;
}

export async function disconnectPrisma(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = undefined;
  }
}
