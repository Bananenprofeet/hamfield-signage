/**
 * Seeds a demo user, organization and device for local development.
 * Run with: pnpm db:seed (after migrations).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'admin@example.com';
const DEMO_PASSWORD = 'password123';
const DEMO_PAIRING_CODE = 'DEMO2345';

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Demo Admin',
    },
  });

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      members: {
        create: { userId: user.id, role: 'owner' },
      },
    },
  });

  const existingDevice = await prisma.device.findFirst({
    where: { organizationId: org.id, name: 'Demo Screen' },
  });

  const device =
    existingDevice ??
    (await prisma.device.create({
      data: {
        organizationId: org.id,
        name: 'Demo Screen',
        description: 'Seeded demo device — pair the mock device against this',
        orientation: 'landscape',
        timezone: 'Europe/Amsterdam',
        pairingCode: DEMO_PAIRING_CODE,
        pairingCodeExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }));

  const existingPlaylist = await prisma.playlist.findFirst({
    where: { organizationId: org.id, name: 'Default Playlist' },
  });

  const playlist =
    existingPlaylist ??
    (await prisma.playlist.create({
      data: {
        organizationId: org.id,
        name: 'Default Playlist',
        description: 'Seeded playlist — add media in the dashboard',
        loop: true,
        defaultImageDurationSeconds: 10,
      },
    }));

  await prisma.device.update({
    where: { id: device.id },
    data: { defaultPlaylistId: playlist.id },
  });

  const existingSchedule = await prisma.schedule.findFirst({
    where: { organizationId: org.id, name: 'Office hours' },
  });

  if (!existingSchedule) {
    await prisma.schedule.create({
      data: {
        organizationId: org.id,
        name: 'Office hours',
        playlistId: playlist.id,
        enabled: true,
        priority: 10,
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '17:00',
        deviceAssignments: { create: { deviceId: device.id } },
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Login:        ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Organization: ${org.name} (${org.id})`);
  console.log(`  Device:       ${device.name} (${device.id})`);
  console.log(`  Pairing code: ${device.pairingCode ?? DEMO_PAIRING_CODE}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
