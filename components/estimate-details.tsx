
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-config';

interface Estimate {
  id: string;
  estimate_number: string;
  title: string;
  description: string | null;
  status: string;
  currency: string;
  subtotal: number;
  total: number;
  created_at: string;
  updated_at: string;
}

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

interface EstimateDetailsProps {
  accountId: string;
  estimateId: string;
  canManageEstimates: boolean;
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

export function EstimateDetails({
  accountId,
  estimateId,
  canManageEstimates,
}: EstimateDetailsProps) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadEstimate = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await apiFetch(
        `/api/accounts/${accountId}/estimates/${estimateId}`,
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to load estimate.');
      }

      setEstimate(result.estimate);
      setLineItems(result.line_items || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, estimateId]);

  useEffect(() => {
    loadEstimate();
  }, [loadEstimate]);

  const updateStatus = async (
    status: 'sent' | 'accepted' | 'rejected',
  ) => {
    setSaving(true);
    setError('');

    try {
      const response = await apiFetch(
        `/api/accounts/${accountId}/estimates/${estimateId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to update status.');
      }

      setEstimate(result.estimate);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="p-6 text-muted-foreground">Loading estimate...</p>;
  }

  if (!estimate) {
    return (
      <div className="space-y-3 rounded-lg border p-6">
        <p className="text-destructive">
          {error || 'Estimate not found.'}
        </p>
        <Link
          href={`/accounts/${accountId}/estimates`}
          className="text-sm text-primary underline"
        >
          Back to estimates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {estimate.estimate_number}
          </p>
          <h1 className="text-2xl font-bold">{estimate.title}</h1>
          <p className="mt-2 text-sm">
            Status:{' '}
            <span className="rounded-full bg-muted px-3 py-1 capitalize">
              {estimate.status}
            </span>
          </p>
        </div>

        <Link
          href={`/accounts/${accountId}/estimates`}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          Back to estimates
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {estimate.description && (
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {estimate.description}
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Line Items</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">Quantity</th>
                <th className="p-3 text-right">Unit Price</th>
                <th className="p-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="p-3">{item.description}</td>
                  <td className="p-3 text-right">{item.quantity}</td>
                  <td className="p-3 text-right">
                    {formatMoney(item.unit_price, estimate.currency)}
                  </td>
                  <td className="p-3 text-right font-medium">
                    {formatMoney(item.line_total, estimate.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto max-w-xs space-y-2 border-t pt-4">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatMoney(estimate.subtotal, estimate.currency)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatMoney(estimate.total, estimate.currency)}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="font-semibold">Estimate Information</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Created:</span>{' '}
            {new Date(estimate.created_at).toLocaleString()}
          </p>
          <p>
            <span className="text-muted-foreground">Last Updated:</span>{' '}
            {new Date(estimate.updated_at).toLocaleString()}
          </p>
        </div>
      </section>

      {canManageEstimates && (
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Manage Estimate</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Update the estimate lifecycle status.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {estimate.status === 'draft' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => updateStatus('sent')}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? 'Updating...' : 'Mark as Sent'}
              </button>
            )}

            {estimate.status === 'sent' && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateStatus('accepted')}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Accept Estimate'}
                </button>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => updateStatus('rejected')}
                  className="rounded-md border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Reject Estimate'}
                </button>
              </>
            )}

            {['accepted', 'rejected'].includes(estimate.status) && (
              <p className="text-sm text-muted-foreground">
                This estimate has reached its final status.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
