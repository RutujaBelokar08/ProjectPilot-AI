import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import pino from 'pino';
import { z } from 'zod';

// `dotenv/config` is imported above, before this validation and before Prisma is initialized.
const requiredEnvironment = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
const missingConfiguration = requiredEnvironment.filter(key => !process.env[key]?.trim());
if (missingConfiguration.length) {
  console.error(`ProjectPilot API cannot start. Missing required environment variables: ${missingConfiguration.join(', ')}.`);
  process.exit(1);
}
const prisma = new PrismaClient();
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const app = express();
const port = Number(process.env.PORT ?? 4000);
const isProduction = process.env.NODE_ENV === 'production';
const accessSecret: string = process.env.JWT_SECRET!;
const refreshSecret: string = process.env.JWT_REFRESH_SECRET!;
const accessCookie = 'pp_access'; const refreshCookie = 'pp_refresh';
type JwtPayload = { sub: string; email: string; name: string; type: 'access' | 'refresh'; jti?: string; exp?: number };
type AuthedRequest = Request & { user: JwtPayload };
const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };
const publicUser = (u: { id: string; name: string; email: string; avatarUrl: string | null }) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, initials: u.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() });
const fail = (res: Response, status: number, message: string, details: string) => res.status(status).json({ success: false, message, details });

app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') ?? 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' })); app.use(cookieParser());
const cookieBase = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };
function signAccess(user: { id: string; email: string; name: string }) { return jwt.sign({ sub: user.id, email: user.email, name: user.name, type: 'access' }, accessSecret, { expiresIn: '15m' }); }
function signRefresh(user: { id: string; email: string; name: string }, id: string) { return jwt.sign({ sub: user.id, email: user.email, name: user.name, type: 'refresh', jti: id }, refreshSecret, { expiresIn: '30d' }); }
function hashToken(token: string) { return bcrypt.hash(token, 12); }
async function tokenMatches(token: string, hash: string) { return bcrypt.compare(token, hash); }
async function createSession(res: Response, user: { id: string; email: string; name: string }) {
  const refreshExpiresAt = new Date(Date.now() + 30 * 86400_000);
  log.debug({ userId: user.id, accessTtlSeconds: 900, refreshTtlSeconds: 2_592_000 }, 'Creating authentication tokens');
  const record = await prisma.refreshToken.create({ data: { tokenHash: 'pending', expiresAt: refreshExpiresAt, userId: user.id } });
  const refresh = signRefresh(user, record.id); await prisma.refreshToken.update({ where: { id: record.id }, data: { tokenHash: await hashToken(refresh) } });
  res.cookie(accessCookie, signAccess(user), { ...cookieBase, maxAge: 15 * 60_000 });
  res.cookie(refreshCookie, refresh, { ...cookieBase, maxAge: 30 * 86400_000 });
  log.debug({ userId: user.id, refreshTokenId: record.id, refreshExpiresAt, cookieOptions: { httpOnly: cookieBase.httpOnly, secure: cookieBase.secure, sameSite: cookieBase.sameSite, path: cookieBase.path } }, 'Authentication cookies set');
}
function clearSession(res: Response) { res.clearCookie(accessCookie, cookieBase); res.clearCookie(refreshCookie, cookieBase); }
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies[accessCookie];
  if (!token) { log.debug({ path: req.path }, 'Access cookie missing'); return fail(res, 401, 'Your session has expired. Please sign in again.', 'UNAUTHORIZED'); }
  try { const payload = jwt.verify(token, accessSecret) as unknown as JwtPayload; if (payload.type !== 'access') throw new Error('Wrong token type'); log.debug({ userId: payload.sub, expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined, path: req.path }, 'Access cookie validated'); (req as AuthedRequest).user = payload; next(); }
  catch (err) { log.warn({ err, path: req.path, cookiePresent: true }, 'Access cookie rejected'); fail(res, 401, 'Your session has expired. Please sign in again.', 'UNAUTHORIZED'); }
}
const registerSchema = z.object({ name: z.string().trim().min(2, 'Name must have at least 2 characters.').max(80), email: z.string().trim().email('Enter a valid email address.').transform(x => x.toLowerCase()), password: z.string().min(8, 'Password must be at least 8 characters.').max(128) });
const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address.').transform(x => x.toLowerCase()), password: z.string().min(1, 'Password is required.') });
app.post('/api/auth/register', asyncRoute(async (req, res) => { const input = registerSchema.parse(req.body); const existing = await prisma.user.findUnique({ where: { email: input.email } }); if (existing) return void fail(res, 409, 'An account already exists for this email.', 'EMAIL_TAKEN'); const user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } }); await createSession(res, user); res.status(201).json({ success: true, user: publicUser(user) }); }));
app.post('/api/auth/login', asyncRoute(async (req, res) => { const input = loginSchema.parse(req.body); const user = await prisma.user.findUnique({ where: { email: input.email } }); if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return void fail(res, 401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS'); await createSession(res, user); res.json({ success: true, user: publicUser(user) }); }));
app.post('/api/auth/refresh', asyncRoute(async (req, res) => { const token = req.cookies[refreshCookie]; log.debug({ cookiePresent: Boolean(token) }, 'Reading refresh cookie'); try { const payload = jwt.verify(token, refreshSecret) as unknown as JwtPayload; if (payload.type !== 'refresh' || !payload.jti) throw new Error('Invalid token'); const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti }, include: { user: true } }); if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !(await tokenMatches(token, stored.tokenHash))) throw new Error('Session expired'); log.debug({ userId: payload.sub, refreshTokenId: stored.id }, 'Refresh token validated; rotating session'); await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } }); await createSession(res, stored.user); res.json({ success: true, user: publicUser(stored.user) }); } catch (err) { log.warn({ err, cookiePresent: Boolean(token) }, 'Refresh token rejected'); clearSession(res); fail(res, 401, 'Please sign in to continue.', 'SESSION_EXPIRED'); } }));
app.get('/api/auth/refresh', (_req, res) => fail(res, 405, 'Refresh tokens must be requested with POST.', 'METHOD_NOT_ALLOWED'));
app.post('/api/auth/logout', asyncRoute(async (req, res) => { const token = req.cookies[refreshCookie]; if (token) { try { const p = jwt.verify(token, refreshSecret) as unknown as JwtPayload; if (p.jti) await prisma.refreshToken.updateMany({ where: { id: p.jti }, data: { revokedAt: new Date() } }); } catch { /* Expired tokens are safely cleared below. */ } } clearSession(res); res.json({ success: true, message: 'Signed out.' }); }));
app.get('/api/auth/me', requireAuth, asyncRoute(async (req, res) => { const user = await prisma.user.findUnique({ where: { id: (req as AuthedRequest).user.sub } }); if (!user) return void fail(res, 401, 'Account no longer exists.', 'UNAUTHORIZED'); res.json({ success: true, user: publicUser(user) }); }));
app.patch('/api/auth/me', requireAuth, asyncRoute(async (req, res) => { const input = z.object({ name: z.string().trim().min(2).max(80), avatarUrl: z.string().url().nullable().optional() }).parse(req.body); const user = await prisma.user.update({ where: { id: (req as AuthedRequest).user.sub }, data: input }); res.json({ user: publicUser(user) }); }));

const projectSchema = z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(20).max(5000), domain: z.string().trim().min(2).max(80), competition: z.string().trim().max(120).optional() });
function analyse(p: { title: string; description: string; domain: string }) { const score = (n: number) => Math.min(95, n + ((p.title.length + p.description.length) % 8)); return { overallScore: score(74), scores: { novelty: score(72), feasibility: score(81), market: score(76), patent: score(68), impact: score(84), readiness: score(78) }, summary: `${p.title} addresses a tangible ${p.domain.toLowerCase()} opportunity with a viable early-stage validation path.`, insights: [{ label: 'Problem statement', value: p.description.slice(0, 180) }, { label: 'Target users', value: 'Primary end users, operational decision-makers, and early adopter organizations.' }, { label: 'Technical feasibility', value: 'High for an MVP using modular services, secure APIs, and measurable pilot metrics.' }, { label: 'Risk analysis', value: 'Validate data access, user trust, and differentiation before scaling.' }], similar: [{ source: 'GitHub', title: 'Open-source reference implementation', similarity: 62, relevance: 'Architecture inspiration', url: 'https://github.com' }, { source: 'Research', title: 'Recent domain research', similarity: 54, relevance: 'Evidence and methodology', url: 'https://scholar.google.com' }, { source: 'Patent', title: 'Adjacent patent landscape', similarity: 47, relevance: 'Freedom-to-operate review', url: 'https://patents.google.com' }], gaps: ['Define a narrow first pilot and baseline metric.', 'Add a defensible data or workflow advantage.', 'Map consent, safety, and compliance requirements early.'], recommendations: ['Build a thin vertical slice before a broad platform.', 'Instrument outcome metrics from day one.', 'Create a differentiated feedback loop with target users.'], roadmap: [{ phase: 'Discover', weeks: 'Weeks 1–2', outcome: 'User interviews, scope, success metrics' }, { phase: 'Validate', weeks: 'Weeks 3–6', outcome: 'MVP prototype and pilot' }, { phase: 'Launch', weeks: 'Weeks 7–10', outcome: 'Measure outcomes and iterate' }], techStack: ['React + TypeScript', 'Node.js API', 'PostgreSQL', 'Vector search', 'LLM provider adapter'] }; }
app.get('/api/projects', requireAuth, async (req, res) => { const projects = await prisma.project.findMany({ where: { userId: (req as AuthedRequest).user.sub }, orderBy: { createdAt: 'desc' }, include: { analyses: { take: 1, orderBy: { createdAt: 'desc' } } } }); res.json(projects); });
app.post('/api/projects', requireAuth, async (req, res) => { const input = projectSchema.parse(req.body); const project = await prisma.project.create({ data: { ...input, userId: (req as AuthedRequest).user.sub } }); res.status(201).json(project); });
app.get('/api/projects/:id', requireAuth, async (req, res) => { const project = await prisma.project.findFirst({ where: { id: String(req.params.id), userId: (req as AuthedRequest).user.sub }, include: { analyses: { orderBy: { createdAt: 'desc' }, take: 1 } } }); if (!project) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } }); res.json(project); });
app.post('/api/projects/:id/analyze', requireAuth, async (req, res) => { const project = await prisma.project.findFirst({ where: { id: String(req.params.id), userId: (req as AuthedRequest).user.sub } }); if (!project) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found.' } }); const payload = analyse(project); await prisma.analysis.create({ data: { projectId: project.id, payload } }); await prisma.project.update({ where: { id: project.id }, data: { status: 'analyzed' } }); res.json(payload); });
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api', (_req, res) => fail(res, 404, 'API route not found.', 'NOT_FOUND'));
app.use((err: unknown, _: Request, res: Response, __: NextFunction) => { if (err instanceof z.ZodError) return fail(res, 400, err.issues[0]?.message ?? 'Invalid request.', 'VALIDATION_ERROR'); const record = err as { code?: unknown; errorCode?: unknown; message?: unknown }; const prismaCode = String(record?.code ?? record?.errorCode ?? ''); const databaseUnavailable = err instanceof Prisma.PrismaClientInitializationError || ['P1001', 'P1012', 'P2021'].includes(prismaCode); log.error({ err, prismaCode, databaseUnavailable }, 'Unhandled request exception'); if (databaseUnavailable) return fail(res, 503, 'The database is unavailable or has not been migrated.', prismaCode || 'P1001'); fail(res, 500, 'Unexpected server error.', prismaCode || 'INTERNAL_ERROR'); });
app.listen(port, () => log.info({ port }, 'ProjectPilot API listening'));
