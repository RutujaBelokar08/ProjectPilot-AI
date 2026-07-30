import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash('Demo@123', 12);
await prisma.user.upsert({ where: { email: 'demo@projectpilot.ai' }, update: { name: 'Demo User', passwordHash }, create: { email: 'demo@projectpilot.ai', name: 'Demo User', passwordHash } });
await prisma.$disconnect();
