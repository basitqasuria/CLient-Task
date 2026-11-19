# Kontrora — Revenue & Billing Estimates

A revenue and billing slice for the Kontrora PSA platform, built with Next.js App Router and Supabase.

This implementation focuses on account-scoped estimates, secure financial operations, idempotent creation, and estimate lifecycle management.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Supabase
- PostgreSQL
- Vitest
- Tailwind CSS

## Features

### Estimates

- Create draft estimates under an account.
- Associate an estimate with an optional project belonging to the same account.
- Add and manage line items.
- Store monetary values in integer minor units (for example, `$25.00` is stored as `2500`).
- Calculate line totals and estimate totals on the server.
- Generate unique estimate numbers.
- Prevent duplicate estimate creation using the `Idempotency-Key` request header.

### Estimate Lifecycle

Supported transitions:

```text
draft → sent → accepted
               → rejected
```

- New estimates start as drafts.
- Draft estimates can be sent.
- Sent estimates can be accepted or rejected.
- Hard deletion is not supported.

### Account-Level Access Control

- Estimates are scoped to their owning account.
- Account permissions are checked before accessing financial data.
- Project associations are validated against the estimate's account.
- API queries include account-level filters.
- Estimate viewing and management use separate permissions.

## Architecture Decisions

### Account-scoped data

Every estimate belongs to an account. The optional project association must belong to that same account.

This prevents an estimate from being associated with a project outside its owning account.

### Money representation

Monetary values are stored as `BIGINT` minor units rather than floating-point numbers.

This avoids floating-point precision problems in financial calculations.

### Server-side calculations

Line totals and estimate totals are calculated by the database function rather than trusted from the client.

### Idempotent creation

Estimate creation requires an `Idempotency-Key`.

The database function checks for an existing estimate with the same account and key before creating a new record.

### Database function

`create_account_estimate` creates the estimate and its line items within one database transaction. If an operation fails, the transaction rolls back.

### No hard deletes

The estimate lifecycle does not expose a delete endpoint. This avoids permanently removing financial records.

## API Overview

Base path:

```text
/api/accounts/:accountId/estimates
```

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/accounts/:accountId/estimates` | List estimates with server-side pagination and filtering |
| POST | `/api/accounts/:accountId/estimates` | Create a draft estimate |
| GET | `/api/accounts/:accountId/estimates/:estimateId` | Get estimate details and line items |
| PATCH | `/api/accounts/:accountId/estimates/:estimateId` | Update estimate lifecycle status |

### Create Estimate

The create endpoint requires:

```http
Idempotency-Key: unique-request-key
```

Example request body:

```json
{
  "title": "Website Development",
  "description": "Website development estimate",
  "project_id": null,
  "currency": "USD",
  "line_items": [
    {
      "description": "Frontend Development",
      "quantity": 10,
      "unit_price": 5000
    }
  ]
}
```

`unit_price` is expressed in minor units. In this example, `5000` represents `$50.00`.

## Security and Tenancy Review

- Authentication is required for estimate API access.
- `view_estimates` controls estimate viewing.
- `manage_estimates` controls estimate creation and lifecycle management.
- Permissions are checked within the requested account context.
- Database reads and updates are scoped by both estimate ID and account ID.
- Project ownership is validated before estimate creation.
- The administrative Supabase client is used only after authentication and permission checks.
- The estimate creation database function is executable only by `service_role`.
- Row Level Security is enabled on estimate tables.
- No public or authenticated execution grant is given to the estimate creation function.

The service-role key must remain server-side and must never be exposed to browser code.

## Local Setup

### Requirements

- Node.js 20.9 or later
- npm
- A Supabase project

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create `.env.local` from `.env.local.template` and configure the Supabase credentials required by the application.

Do not commit `.env.local` or expose service-role credentials.

### Database setup

Run the SQL files in the Supabase SQL Editor in this order:

1. `supabase/schema.sql`
2. `supabase/seed-roles.sql`
3. `supabase/migrations/20261119_estimates.sql`

The migration adds the estimate-specific columns, indexes, constraints, database function, and permissions required by this feature.

### Seed users

```bash
npm run seed:users
```

### Start development server

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Tests and Quality Checks

Run the available project scripts:

```bash
npm test
npm run lint
npm run build
```

Tests should cover estimate creation, idempotency, lifecycle transitions, account isolation, and permission enforcement.

## What I Would Ship Next

- Automated integration tests against a dedicated Supabase test database.
- Stronger idempotency conflict handling for concurrent requests and mismatched payloads.
- Estimate PDF generation and email delivery.
- Stripe integration for payment collection.
- Payment reconciliation and financial reporting.
- Audit history for estimate lifecycle changes.
- Currency-aware formatting and localization.

## Submission

This repository is submitted as a fork of the original assignment repository.

No pull request is required.