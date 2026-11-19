import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase-server';
import {
  requireAuthAndPermission,
  handleGuardError,
} from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import { logger } from '@/lib/debug-logger';
import { isValidUUID } from '@/lib/validation-helpers';

/**
 * GET /api/accounts/[accountId]/estimates/[estimateId]
 * Fetch one estimate and its line items.
 */
async function GET(request, { params }) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json(
        { error: 'Invalid account ID or estimate ID format' },
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

    const { data: estimate, error: estimateError } = await supabase
      .from('estimates')
      .select(`
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
        created_by,
        created_at,
        updated_at
      `)
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (estimateError) {
      logger.error('Error fetching estimate', {
        accountId,
        estimateId,
        error: estimateError.message,
      });

      return NextResponse.json(
        { error: 'Failed to fetch estimate' },
        { status: 500 }
      );
    }

    if (!estimate) {
      return NextResponse.json(
        { error: 'Estimate not found' },
        { status: 404 }
      );
    }

    const { data: lineItems, error: lineItemsError } = await supabase
      .from('estimate_line_items')
      .select(`
        id,
        estimate_id,
        description,
        quantity,
        unit_price,
        line_total,
        sort_order,
        created_at,
        updated_at
      `)
      .eq('estimate_id', estimateId)
      .order('sort_order', { ascending: true });

    if (lineItemsError) {
      console.error('ESTIMATE LINE ITEMS DB ERROR:', lineItemsError);
      logger.error('Error fetching estimate line items', {
        accountId,
        estimateId,
        error: lineItemsError.message,
      });

      return NextResponse.json(
        { error: 'Failed to fetch estimate line items' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      estimate,
      line_items: lineItems || [],
    });
  } catch (error) {
    logger.error('Error in GET estimate by ID', {}, error);
    return handleGuardError(error);
  }
}

/**
 * PATCH /api/accounts/[accountId]/estimates/[estimateId]
 * Update estimate lifecycle status.
 *
 * Allowed transitions:
 * draft -> sent
 * sent -> accepted | rejected
 */
async function PATCH(request, { params }) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json(
        { error: 'Invalid account ID or estimate ID format' },
        { status: 400 }
      );
    }

    await requireAuthAndPermission(
      Permission.MANAGE_ESTIMATES,
      { accountId },
      request
    );

    let body;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON request body' },
        { status: 400 }
      );
    }

    const newStatus = body?.status;

    if (!['sent', 'accepted', 'rejected'].includes(newStatus)) {
      return NextResponse.json(
        { error: 'Invalid target status' },
        { status: 400 }
      );
    }

    const supabase = createAdminSupabaseClient();

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 500 }
      );
    }

    const { data: estimate, error: fetchError } = await supabase
      .from('estimates')
      .select('id, account_id, status')
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (fetchError) {
      logger.error('Error fetching estimate for status update', {
        accountId,
        estimateId,
        error: fetchError.message,
      });

      return NextResponse.json(
        { error: 'Failed to fetch estimate' },
        { status: 500 }
      );
    }

    if (!estimate) {
      return NextResponse.json(
        { error: 'Estimate not found' },
        { status: 404 }
      );
    }

    const allowedTransitions = {
      draft: ['sent'],
      sent: ['accepted', 'rejected'],
    };

    if (!allowedTransitions[estimate.status]?.includes(newStatus)) {
      return NextResponse.json(
        {
          error: `Cannot change estimate status from ${estimate.status} to ${newStatus}`,
        },
        { status: 409 }
      );
    }

    const { data: updatedEstimate, error: updateError } = await supabase
      .from('estimates')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .eq('status', estimate.status)
      .select()
      .maybeSingle();

    if (updateError) {
      logger.error('Error updating estimate status', {
        accountId,
        estimateId,
        error: updateError.message,
      });

      return NextResponse.json(
        { error: 'Failed to update estimate status' },
        { status: 500 }
      );
    }

    if (!updatedEstimate) {
      return NextResponse.json(
        { error: 'Estimate status changed concurrently. Please retry.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      estimate: updatedEstimate,
    });
  } catch (error) {
    logger.error('Error in PATCH estimate status', {}, error);
    return handleGuardError(error);
  }
}

export { GET, PATCH };
