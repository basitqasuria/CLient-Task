import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import {
  requireAuthAndPermission,
  handleGuardError,
} from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import { logger } from '@/lib/debug-logger';
import { isValidUUID } from '@/lib/validation-helpers';

const ALLOWED_STATUSES = ['draft', 'sent', 'accepted', 'rejected'];

/**
 * GET /api/accounts/[accountId]/estimates
 * List estimates belonging to an authorized account.
 */
async function GET(request, { params }) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json(
        { error: 'Invalid account ID format' },
        { status: 400 }
      );
    }

    await requireAuthAndPermission(
      Permission.VIEW_ESTIMATES,
      { accountId },
      request
    );

    const supabase = createAdminSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const parsedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);

    const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, parsedLimit))
      : 20;

    const status = searchParams.get('status');
    const search = (searchParams.get('search') || '').trim().slice(0, 100);

    if (status && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid estimate status' },
        { status: 400 }
      );
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('estimates')
      .select(
        `
          id,
          account_id,
          project_id,
          estimate_number,
          title,
          description,
          status,
          currency,
          subtotal,
          total,
          created_at,
          updated_at
        `,
        { count: 'exact' }
      )
      .eq('account_id', accountId);

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) {
      logger.error('Error listing account estimates', {}, error);
      console.error('ESTIMATES LIST DB ERROR:', error);
      return NextResponse.json(
        { error: 'Failed to fetch estimates' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      estimates: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    logger.error('Error in GET account estimates', {}, error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/accounts/[accountId]/estimates
 * Create a draft estimate with line items.
 */
async function POST(request, { params }) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json(
        { error: 'Invalid account ID format' },
        { status: 400 }
      );
    }

    // Authenticate and authorize before using the admin client.
    const user = await requireAuthAndPermission(
      Permission.MANAGE_ESTIMATES,
      { accountId },
      request
    );

    const idempotencyKey = request.headers.get('Idempotency-Key');

    if (
      !idempotencyKey ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 255
    ) {
      return NextResponse.json(
        { error: 'A valid Idempotency-Key header is required' },
        { status: 400 }
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON request body' },
        { status: 400 }
      );
    }

    const {
      title,
      description,
      project_id,
      currency,
      line_items,
    } = body || {};

    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 200
    ) {
      return NextResponse.json(
        { error: 'Title is required and must be under 200 characters' },
        { status: 400 }
      );
    }

    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== 'string' || description.length > 5000)
    ) {
      return NextResponse.json(
        { error: 'Invalid estimate description' },
        { status: 400 }
      );
    }

    if (
      project_id !== undefined &&
      project_id !== null &&
      !isValidUUID(project_id)
    ) {
      return NextResponse.json(
        { error: 'Invalid project ID format' },
        { status: 400 }
      );
    }

    const estimateCurrency = currency || 'USD';

    if (
      typeof estimateCurrency !== 'string' ||
      !/^[A-Z]{3}$/.test(estimateCurrency)
    ) {
      return NextResponse.json(
        { error: 'Currency must be a valid three-letter uppercase code' },
        { status: 400 }
      );
    }

    if (
      !Array.isArray(line_items) ||
      line_items.length < 1 ||
      line_items.length > 100
    ) {
      return NextResponse.json(
        { error: 'Between 1 and 100 line items are required' },
        { status: 400 }
      );
    }

    const validatedItems = [];

    for (const item of line_items) {
      if (!item || typeof item !== 'object') {
        return NextResponse.json(
          { error: 'Invalid line item' },
          { status: 400 }
        );
      }

      const itemDescription =
        typeof item.description === 'string'
          ? item.description.trim()
          : '';

      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);

      if (
        !itemDescription ||
        itemDescription.length > 500 ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 1000000 ||
        !Number.isInteger(quantity * 1000) ||
        !Number.isSafeInteger(unitPrice) ||
        unitPrice < 0
      ) {
        return NextResponse.json(
          { error: 'Invalid line item description, quantity, or unit price' },
          { status: 400 }
        );
      }

      validatedItems.push({
        description: itemDescription,
        quantity,
        unit_price: unitPrice,
      });
    }

    const supabase = createAdminSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    const { data, error } = await supabase.rpc(
      'create_account_estimate',
      {
        p_account_id: accountId,
        p_project_id: project_id || null,
        p_title: title.trim(),
        p_description: description?.trim() || null,
        p_currency: estimateCurrency,
        p_created_by: user.id,
        p_idempotency_key: idempotencyKey.trim(),
        p_line_items: validatedItems,
      }
    );

    if (error) {
      logger.error('Failed to create account estimate', {
        accountId,
        userId: user.id,
        error: error.message,
      });

      return NextResponse.json(
        { error: 'Failed to create estimate' },
        { status: 500 }
      );
    }

    if (!data || !data.estimate) {
      logger.error('Estimate creation returned an invalid response', {
        accountId,
        userId: user.id,
      });

      return NextResponse.json(
        { error: 'Invalid response from estimate creation' },
        { status: 500 }
      );
    }

    logger.info('Account estimate created', {
      accountId,
      estimateId: data.estimate.id,
      userId: user.id,
      replayed: data.replayed,
    });

    return NextResponse.json(
      {
        success: true,
        estimate: data.estimate,
        line_items: data.line_items || [],
        replayed: data.replayed || false,
      },
      { status: data.replayed ? 200 : 201 }
    );
  } catch (error) {
    logger.error('Error in POST account estimates', {}, error);
    return handleGuardError(error);
  }
}

export { GET, POST };
