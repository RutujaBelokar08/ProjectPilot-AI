# ProjectPilot AI

ProjectPilot AI validates ideas before implementation. It combines structured AI analysis, similarity discovery, innovation scoring, gap analysis, roadmaps and export-ready project documentation.

## Quick start

1. Copy `apps/api/.env.example` to `apps/api/.env`. The included local values point to the Docker Compose PostgreSQL service; replace JWT secrets for any shared environment.
2. Run `npm.cmd install`.
3. Run `npm.cmd --workspace @projectpilot/api run prisma:generate`.
4. Start PostgreSQL with `docker compose up db -d`, then run `npm.cmd --workspace @projectpilot/api run prisma:deploy` and `npm.cmd --workspace @projectpilot/api run seed`.
5. Run `npm.cmd run dev` and open `http://localhost:5173`.

The API runs at `http://localhost:4000`. It refuses to start if `DATABASE_URL`, `JWT_SECRET`, or `JWT_REFRESH_SECRET` are absent. Add an OpenAI-compatible provider adapter in `apps/api/src/modules/analysis` to enable live generation.

## Docker deployment

`docker compose up --build`

For production, put the web service behind TLS, rotate `JWT_SECRET`, use a managed PostgreSQL instance, configure database migrations, and store provider credentials in your deployment secret manager.

## API

`POST /api/auth/register`, `POST /api/auth/login`, `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/analyze`.

Authentication uses short-lived access and rotating refresh JWTs in `HttpOnly`, `SameSite=Lax` cookies. All project routes are protected and scoped by the authenticated user. API errors use `{ error: { code, message } }`.

The seeded demo account is `demo@projectpilot.ai` / `Demo@123`.

## Architecture

- `apps/web`: React/Vite single-page app, accessibility-minded dashboard and responsive CSS.
- `apps/api`: Express REST API, Zod request validation, JWT auth, service/repository seams and structured logging.
- `apps/api/prisma/schema.prisma`: PostgreSQL schema for users, projects and persisted analyses.

The provider boundary is intentionally isolated so external sources (GitHub, papers, patent indexes and LLMs) can be added without changing HTTP handlers or UI contracts.
