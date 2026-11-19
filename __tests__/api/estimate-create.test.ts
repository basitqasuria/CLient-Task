
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthAndPermission: vi.fn(),
  handleGuardError: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  rpc: vi.fn(),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
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
    info: mocks.loggerInfo,
  },
}));

vi.mock('@/lib/validation-helpers', () => ({
  isValidUUID: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ),
}));

import { POST } from '@/app/api/accounts/[accountId]/estimates/route';

const accountId = '550e8400-e29b-41d4-a716-446655440000';

const validBody = {
  title: 'Website Development',
  currency: 'USD',
  line_items: [
    {
      description: 'Frontend Development',
      quantity: 2,
      unit_price: 2500,
    },
    {
      description: 'Backend Development',
      quantity: 1.5,
      unit_price: 3000,
    },
  ],
};

function createRequest(
  body: unknown,
  idempotencyKey = 'test-idempotency-key',
) {
  return new Request('http://localhost/api/estimates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('POST account estimates API', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireAuthAndPermission.mockResolvedValue({
      id: 'user-123',
    });

    mocks.createAdminSupabaseClient.mockReturnValue({
      rpc: mocks.rpc,
    });

    mocks.rpc.mockResolvedValue({
      data: {
        estimate: { id: 'estimate-123', title: validBody.title },
        line_items: [],
        replayed: false,
      },
      error: null,
    });

    mocks.handleGuardError.mockImplementation(() => ({
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    }));
  });

  it('rejects an invalid account ID', async () => {
    const response = await POST(createRequest(validBody), {
      params: Promise.resolve({ accountId: 'invalid-id' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.requireAuthAndPermission).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a missing idempotency key', async () => {
    const request = new Request('http://localhost/api/estimates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const response = await POST(request, {
      params: Promise.resolve({ accountId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid line items', async () => {
    const response = await POST(
      createRequest({
        ...validBody,
        line_items: [
          {
            description: 'Invalid item',
            quantity: -2,
            unit_price: 2500,
          },
        ],
      }),
      { params: Promise.resolve({ accountId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('creates an estimate using the database function', async () => {
    const response = await POST(createRequest(validBody), {
      params: Promise.resolve({ accountId }),
    });

    const result = await response.json();

    expect(response.status).toBe(201);
    expect(result.success).toBe(true);
    expect(result.replayed).toBe(false);

    expect(mocks.requireAuthAndPermission).toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_account_estimate',
      expect.objectContaining({
        p_account_id: accountId,
        p_created_by: 'user-123',
        p_idempotency_key: 'test-idempotency-key',
        p_line_items: validBody.line_items,
      }),
    );
  });

  it('returns status 200 when the database reports an idempotent replay', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        estimate: { id: 'estimate-123' },
        line_items: [],
        replayed: true,
      },
      error: null,
    });

    const response = await POST(createRequest(validBody), {
      params: Promise.resolve({ accountId }),
    });

    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.replayed).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('does not call the database when authorization fails', async () => {
    mocks.requireAuthAndPermission.mockRejectedValue(
      new Error('Forbidden'),
    );

    const response = await POST(createRequest(validBody), {
      params: Promise.resolve({ accountId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
