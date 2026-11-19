
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCurrentUserProfileServer } from '@/lib/auth-server';
import { accountService } from '@/lib/account-service';
import { AccountEstimates } from '@/components/account-estimates';
import { hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import {
  createServerSupabase,
  createAdminSupabaseClient,
} from '@/lib/supabase-server';

interface EstimatesPageProps {
  params: Promise<{
    accountId: string;
  }>;
}

export async function generateMetadata({
  params,
}: EstimatesPageProps): Promise<Metadata> {
  const { accountId } = await params;

  const supabase = await createServerSupabase();

  if (!supabase) {
    return { title: 'Estimates' };
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .single();

  return {
    title: account?.name
      ? `Estimates - ${account.name}`
      : 'Estimates',
  };
}

export default async function EstimatesPage({
  params,
}: EstimatesPageProps) {
  const { accountId } = await params;

  // Authenticate user
  const userProfile = await getCurrentUserProfileServer();

  if (!userProfile) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-muted-foreground">
          Please log in to view estimates.
        </p>
      </div>
    );
  }

  const supabase = await createServerSupabase();

  if (!supabase) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Database Error</h1>
        <p className="mt-2 text-muted-foreground">
          Unable to connect to database.
        </p>
      </div>
    );
  }

  // Check account-level permissions
const [canViewEstimates, canManageEstimates] = await Promise.all([
  hasPermission(userProfile, Permission.VIEW_ESTIMATES, { accountId }, supabase),
  hasPermission(userProfile, Permission.MANAGE_ESTIMATES, { accountId }, supabase),
]);

  if (!canViewEstimates) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="mt-2 text-muted-foreground">
          You do not have permission to view estimates for this account.
        </p>
      </div>
    );
  }

  // Fetch data only after permission verification
  const adminClient = createAdminSupabaseClient();
  const queryClient = adminClient || supabase;

  const [account, projects] = await Promise.all([
    accountService.getAccountById(
      accountId,
      undefined,
      queryClient as any,
    ),
    accountService.getAccountProjects(
      accountId,
      undefined,
      queryClient as any,
    ),
  ]);

  if (!account) {
    notFound();
  }

  const projectOptions = projects.map((project) => ({
    id: project.id,
    name: project.name,
  }));

  return (
    <main className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Estimates</h1>
        <p className="mt-1 text-muted-foreground">
          Manage estimates for {account.name}.
        </p>
      </div>

      <AccountEstimates
        accountId={accountId}
        projects={projectOptions}
        canManageEstimates={canManageEstimates}
      />
    </main>
  );
}
