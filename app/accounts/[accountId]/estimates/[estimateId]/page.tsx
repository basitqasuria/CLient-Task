
import { Metadata } from 'next';
import { getCurrentUserProfileServer } from '@/lib/auth-server';
import { hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { createServerSupabase } from '@/lib/supabase-server';
import { EstimateDetails } from '@/components/estimate-details';

interface EstimatePageProps {
  params: Promise<{
    accountId: string;
    estimateId: string;
  }>;
}

export async function generateMetadata({
  params,
}: EstimatePageProps): Promise<Metadata> {
  return {
    title: 'Estimate Details',
  };
}

export default async function EstimatePage({
  params,
}: EstimatePageProps) {
  const { accountId, estimateId } = await params;

  // Authenticate user
  const userProfile = await getCurrentUserProfileServer();

  if (!userProfile) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-muted-foreground">
          Please log in to view this estimate.
        </p>
      </main>
    );
  }

  const supabase = await createServerSupabase();

  if (!supabase) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Database Error</h1>
        <p className="mt-2 text-muted-foreground">
          Unable to connect to database.
        </p>
      </main>
    );
  }

  // Verify account-level permissions
  const [canViewEstimates, canManageEstimates] = await Promise.all([
    hasPermission(userProfile, Permission.VIEW_ESTIMATES, { accountId }),
    hasPermission(userProfile, Permission.MANAGE_ESTIMATES, { accountId }),
  ]);

  if (!canViewEstimates) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-muted-foreground">
          You do not have permission to view this estimate.
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto space-y-6 p-6">
      <EstimateDetails
        accountId={accountId}
        estimateId={estimateId}
        canManageEstimates={canManageEstimates}
      />
    </main>
  );
}
