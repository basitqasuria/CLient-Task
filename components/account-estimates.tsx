'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-config';

interface ProjectOption {
  id: string;
  name: string;
}

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
}

interface LineItem {
  description: string;
  quantity: string;
  unit_price: string;
}

interface AccountEstimatesProps {
  accountId: string;
  projects: ProjectOption[];
  canManageEstimates: boolean;
}

const emptyLineItem: LineItem = {
  description: '',
  quantity: '1',
  unit_price: '0.00',
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100);
}

export function AccountEstimates({
  accountId,
  projects,
  canManageEstimates,
}: AccountEstimatesProps) {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ ...emptyLineItem }]);

  const loadEstimates = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await apiFetch(`/api/accounts/${accountId}/estimates`);

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to load estimates.');
      }

      setEstimates(result.estimates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadEstimates();
  }, [loadEstimates]);

  const updateLineItem = (index: number, field: keyof LineItem, value: string) => {
    setLineItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
  };

  const addLineItem = () => {
    setLineItems((current) => [...current, { ...emptyLineItem }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const calculateTotal = () =>
    lineItems.reduce((total, item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);

      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
        return total;
      }

      return total + quantity * unitPrice;
    }, 0);

  const createEstimate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please enter an estimate title.');
      return;
    }

    if (
      lineItems.some(
        (item) =>
          !item.description.trim() ||
          !Number.isFinite(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(item.unit_price)) ||
          Number(item.unit_price) < 0,
      )
    ) {
      setError('Please check all line item fields.');
      return;
    }

    setSaving(true);

    try {
      const response = await apiFetch(`/api/accounts/${accountId}/estimates`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          project_id: projectId || null,
          currency,
          line_items: lineItems.map((item) => ({
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unit_price: Math.round(Number(item.unit_price) * 100),
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to create estimate.');
      }

      setTitle('');
      setDescription('');
      setProjectId('');
      setCurrency('USD');
      setLineItems([{ ...emptyLineItem }]);
      setShowForm(false);

      await loadEstimates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">All Estimates</h2>
          <p className="mt-1 text-sm text-muted-foreground">View and manage account estimates.</p>
        </div>

        {canManageEstimates && (
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {showForm ? 'Cancel' : 'New Estimate'}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {showForm && canManageEstimates && (
        <form onSubmit={createEstimate} className="space-y-5 rounded-lg border p-5">
          <h3 className="text-lg font-semibold">Create Estimate</h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="estimate-title" className="text-sm font-medium">
                Estimate Title *
              </label>
              <input
                id="estimate-title"
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Website Development"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="estimate-project" className="text-sm font-medium">
                Project (Optional)
              </label>
              <select
                id="estimate-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="estimate-description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="estimate-description"
              maxLength={5000}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Additional details..."
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="estimate-currency" className="text-sm font-medium">
              Currency
            </label>
            <select
              id="estimate-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="USD">USD</option>
              <option value="PKR">PKR</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Line Items</h4>
              <button
                type="button"
                onClick={addLineItem}
                disabled={lineItems.length >= 100}
                className="text-sm font-medium text-primary disabled:opacity-50"
              >
                + Add Item
              </button>
            </div>

            {lineItems.map((item, index) => (
              <div key={index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-12">
                <div className="space-y-1 sm:col-span-5">
                  <label className="text-xs font-medium">Description</label>
                  <input
                    required
                    maxLength={500}
                    value={item.description}
                    onChange={(event) => updateLineItem(index, 'description', event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Development work"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium">Quantity</label>
                  <input
                    required
                    type="number"
                    min="0.001"
                    max="1000000"
                    step="0.001"
                    value={item.quantity}
                    onChange={(event) => updateLineItem(index, 'quantity', event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div className="space-y-1 sm:col-span-3">
                  <label className="text-xs font-medium">Unit Price ({currency})</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(event) => updateLineItem(index, 'unit_price', event.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex items-end sm:col-span-2">
                  <button
                    type="button"
                    disabled={lineItems.length === 1}
                    onClick={() => removeLineItem(index)}
                    className="w-full rounded-md border px-2 py-2 text-sm text-destructive disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="font-semibold">
              Estimated Total: {currency} {calculateTotal().toFixed(2)}
            </p>

            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Draft'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading estimates...</p>
        ) : estimates.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No estimates found for this account.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 font-medium">Estimate</th>
                <th className="p-3 font-medium">Title</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 text-right font-medium">Total</th>
                <th className="p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((estimate) => (
                <tr key={estimate.id} className="border-t">
                  <td className="p-3 font-medium">
                    <Link
                      href={`/accounts/${accountId}/estimates/${estimate.id}`}
                      className="text-primary hover:underline"
                    >
                      {estimate.estimate_number}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/accounts/${accountId}/estimates/${estimate.id}`}
                      className="hover:underline"
                    >
                      {estimate.title}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize">
                      {estimate.status}
                    </span>
                  </td>
                  <td className="p-3 text-right font-medium">
                    {formatMoney(estimate.total, estimate.currency)}
                  </td>
                  <td className="whitespace-nowrap p-3 text-muted-foreground">
                    {new Date(estimate.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
