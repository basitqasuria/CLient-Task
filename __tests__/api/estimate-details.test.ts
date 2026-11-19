
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthAndPermission: vi.fn(),
  handleGuardError: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  loggerError: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  order: vi.fn(),
  update: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, options?: { status?: number }) => ({
      status: options?.status ?? 200,
      json: async () => body,
    }),
  },
}));

vi.mock('@/lib/supabase-server', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));

vi.mock('@/lib/server-guards', () => ({
  requireAuthAndPermission: mocks.requireAuthAndPermission,
  handleGuardError: mocks.handleGuardError,
}));

vi.mock('@/lib/permissions', () => ({
  Permission: {
    VIEW_ESTIMATES: 'view_estimates',
    MANAGE_ESTIMATES: 'manage_estimates',
  },
}));

vi.mock('@/lib/debug-logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
  },
}));

vi.mock('@/lib/validation-helpers', () => ({
  isValidUUID: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ),
}));

import {
  GET,
  PATCH,
} from '@/app/api/accounts/[accountId]/estimates/[estimateId]/route';

const accountId = '550e8400-e29b-41d4-a716-446655440000';
const estimateId = '660e8400-e29b-41d4-a716-446655440000';

const estimate = {
  id: estimateId,
  account_id: accountId,
  status: 'draft',
};

function createRequest(method: string, body?: unknown) {
  return new Request('http://localhost/api/estimates', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function routeContext(
  account = accountId,
  estimate = estimateId,
) {
  return {
    params: Promise.resolve({
      accountId: account,
      estimateId: estimate,
    }),
  };
}


function setupSupabase() {
  mocks.from.mockImplementation(() => ({
    select: mocks.select,
    update: mocks.update,
  }));

  mocks.select.mockImplementation(() => ({
    eq: mocks.eq,
  }));

  mocks.eq.mockImplementation(() => ({
    eq: mocks.eq,
    maybeSingle: mocks.maybeSingle,
    order: mocks.order,
    select: () => ({
      maybeSingle: mocks.maybeSingle,
    }),
  }));

  mocks.order.mockResolvedValue({
    data: [{ id: 'line-1', description: 'Development' }],
    error: null,
  });

  mocks.update.mockReturnValue({
    eq: mocks.eq,
  });

  mocks.createAdminSupabaseClient.mockReturnValue({
    from: mocks.from,
  });
}


describe('Estimate details API', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireAuthAndPermission.mockResolvedValue({ id: 'user-123' });

    mocks.handleGuardError.mockImplementation(() => ({
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }));

    mocks.maybeSingle.mockResolvedValue({
      data: estimate,
      error: null,
    });

    setupSupabase();
  });

  it('rejects invalid account or estimate IDs', async () => {
    const response = await GET(
      createRequest('GET'),
      routeContext('invalid-id', estimateId),
    );

    expect(response.status).toBe(400);
    expect(mocks.requireAuthAndPermission).not.toHaveBeenCalled();
  });

  it('fetches an estimate scoped to its account', async () => {
    const response = await GET(
      createRequest('GET'),
      routeContext(),
    );

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.estimate).toEqual(estimate);
    expect(result.line_items).toHaveLength(1);
    expect(mocks.from).toHaveBeenCalledWith('estimates');
    expect(mocks.eq).toHaveBeenCalledWith('account_id', accountId);
  });

  it('returns 404 when the estimate does not belong to the account', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });

    const response = await GET(
      createRequest('GET'),
      routeContext(),
    );

    expect(response.status).toBe(404);
  });

  it('allows draft to sent', async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { ...estimate, status: 'draft' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...estimate, status: 'sent' },
        error: null,
      });

    const response = await PATCH(
      createRequest('PATCH', { status: 'sent' }),
      routeContext(),
    );

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.estimate.status).toBe('sent');
  });

  it.each([
    ['sent', 'accepted'],
    ['sent', 'rejected'],
  ])('allows %s to %s', async (currentStatus, newStatus) => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { ...estimate, status: currentStatus },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { ...estimate, status: newStatus },
        error: null,
      });

    const response = await PATCH(
      createRequest('PATCH', { status: newStatus }),
      routeContext(),
    );

    expect(response.status).toBe(200);
  });

  it.each([
    ['draft', 'accepted'],
    ['draft', 'rejected'],
    ['accepted', 'sent'],
    ['rejected', 'sent'],
  ])('rejects transition from %s to %s', async (currentStatus, newStatus) => {
    mocks.maybeSingle.mockResolvedValue({
      data: { ...estimate, status: currentStatus },
      error: null,
    });

    const response = await PATCH(
      createRequest('PATCH', { status: newStatus }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid target status', async () => {
    const response = await PATCH(
      createRequest('PATCH', { status: 'deleted' }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns 409 when another request changes the status concurrently', async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: { ...estimate, status: 'draft' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: null,
      });

    const response = await PATCH(
      createRequest('PATCH', { status: 'sent' }),
      routeContext(),
    );

    expect(response.status).toBe(409);
  });
});
