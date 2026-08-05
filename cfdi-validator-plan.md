# CFDI Validator — Project Plan

## Idea

AI-powered CFDI 4.0 XML validator for the Mexican market. User uploads a rejected/problematic
CFDI XML, the backend validates it against the CFDI 4.0 XSD schema, and an LLM (Llama via
NVIDIA NIM) explains each error in plain Spanish with a suggested fix.

Portfolio project first, with a clear path to a paid product for accountants (contadores) and
small businesses in Mexico.

**Origin**: scoped down from a bigger idea ("Contador's Co-Pilot") found in a deep research
report on AI-driven passive income opportunities in Mexico. The full vision included a nightly
agent connecting directly to the SAT using the client's e.firma — that part is explicitly
OUT of scope for legal reasons (see below).

## Legal constraint — read this before building anything auth-related

The e.firma (FIEL) has the same legal weight as a handwritten signature in Mexico. Whoever
holds the e.firma is 100% responsible for anything done with it — no exceptions, and no
contract or power of attorney actually shields the holder from that liability.

**Decision: this product never touches, stores, or requests a user's e.firma or SAT
credentials.** The entire product operates on files the user uploads manually (XML files
they already have on their machine, already rejected or already issued). No SAT WebService
integration, no automated login, no credential vault. This removes the biggest legal risk
and the biggest trust barrier for a first customer (accountants are very wary of handing
over SAT access, and rightly so).

If a future version wants to automate SAT retrieval, that requires actual legal counsel
first — not a v1/v2 decision to make casually.

## Market context (for pricing later, not urgent now)

- Cloud invoicing software in Mexico: ~$99–$499 MXN/month for individual businesses.
- Multi-RFC accounting software for firms managing many clients: ~$400–$2,000 MXN/month
  for unlimited portfolios (e.g. Alegra).
- Existing players (Alegra, Contadigital) already sell CFDI 4.0 validation as a feature and
  are layering AI on top (bank reconciliation, auto-suggested entries). Confirms real demand
  for AI-assisted compliance tooling — this isn't an unproven category.
- Timbrado (PAC stamping) typically costs $0.50–$2 MXN per CFDI as a reference cost point.

No pricing decision needed yet — just confirms the space is real and accountants already
pay monthly for adjacent tooling.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node + Express + TypeScript |
| ORM | Prisma (typed client generated from schema.prisma) |
| Database | PostgreSQL |
| AI | NVIDIA NIM / Llama 3.3 (existing setup) |
| File upload | Multer |
| Auth | JWT + bcrypt, httpOnly cookies |

Why Prisma over Sequelize: schema-first, fully typed client, less boilerplate, cleaner DX,
and it's a meaningful upgrade to show in a portfolio.

## Pages

1. **Landing page** (public) — product pitch, demo screenshot, CTA to sign up.
2. **Validator** (authenticated) — drag-and-drop XML upload, inline results with plain-Spanish
   error explanations. This is the core screen.
3. **History** (authenticated) — table of past validations: status, error count, timestamp,
   download original/fixed XML.
4. **Auth pages** (public) — register / login.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Returns JWT |
| POST | `/api/validate/upload` | Upload XML → parse → LLM → return structured errors |
| GET | `/api/validate/history` | Paginated validation log for the user |
| GET | `/api/validate/:id` | Single result with full error detail |
| DELETE | `/api/validate/:id` | Remove from history |

## Database schema (Prisma models)

**User**
- id (uuid, pk)
- email (string, unique)
- passwordHash (string)
- createdAt (datetime)

**Validation**
- id (uuid, pk)
- userId (uuid, fk → User)
- filename (string)
- status (enum: valid | errors | fixed)
- errorCount (int)
- rawXml (text)
- llmAnalysis (json) — structured error list from the AI, stored as-is for v1
- createdAt (datetime)

**Error** (v2 — only add once querying error patterns across users matters)
- id (uuid, pk)
- validationId (uuid, fk → Validation)
- errorCode (string) — e.g. "CFDI40-RFC-001"
- fieldPath (string) — XPath of the offending node
- explanation (text) — LLM-generated, in Spanish
- suggestedFix (text) — LLM-generated

## Core upload flow

1. User drops an XML file → frontend sends `multipart/form-data` to `POST /api/validate/upload`.
2. Backend parses the XML and validates it against the official CFDI 4.0 XSD schema
   (deterministic, no AI needed for structural errors).
3. The list of raw XSD violations is sent to the LLM with a system prompt: explain each
   error in plain Spanish, suggest the fix. Returns structured JSON.
4. Result is saved to Postgres via Prisma (`Validation` row, linked to the user via JWT
   middleware).
5. Frontend renders the structured error list with explanation + suggested fix per issue.

## Folder structure

```
cfdi-validator/
  frontend/
    src/components/
    src/pages/
    src/hooks/
    src/types/        ← shared TS types
  backend/
    src/routes/
    src/middleware/
    src/services/      ← xml parser, llm client
    prisma/schema.prisma
  shared/
    types.ts           ← API contract types used by both frontend and backend
```

## Roadmap (post-v1, still legally safe)

- Batch upload (multiple XMLs at once) — still manual upload, still no SAT access.
- Aggregate error stats dashboard ("your top 3 recurring error types this month").
- Export a cleaned/corrected XML file where fixes are deterministic (e.g. formatting issues).
- Multi-client view for accountants managing several RFCs — still upload-based.

Anything involving direct SAT connectivity or e.firma handling is explicitly deferred and
requires legal review before design work starts.

## Next steps in Claude Code

1. Scaffold `backend/` with Express + TypeScript + Prisma, initialize `schema.prisma` with
   the User and Validation models above.
2. Scaffold `frontend/` with Vite + React + TypeScript + Tailwind.
3. Build the upload → XSD validation pipeline first (no AI yet) — get a real CFDI 4.0 XSD
   file and confirm parsing works end to end before touching the LLM call.
4. Wire in the NVIDIA NIM call for error explanation once XSD validation returns real errors.
5. Build the auth flow (register/login/JWT middleware).
6. Build the History page once Validation rows are actually being created.
