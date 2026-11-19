
import { describe, expect, it } from 'vitest';
import {
  Permission,
  PermissionDefinitions,
  PermissionCategories,
  getAllPermissions,
} from '@/lib/permissions';

describe('Estimate permissions', () => {
  it('defines the view estimates permission correctly', () => {
    expect(Permission.VIEW_ESTIMATES).toBe('view_estimates');

    expect(PermissionDefinitions[Permission.VIEW_ESTIMATES]).toEqual({
      name: 'View Estimates',
      description: 'View estimates within assigned accounts',
      category: 'Financial Management',
    });
  });

  it('defines the manage estimates permission correctly', () => {
    expect(Permission.MANAGE_ESTIMATES).toBe('manage_estimates');

    expect(PermissionDefinitions[Permission.MANAGE_ESTIMATES]).toEqual({
      name: 'Manage Estimates',
      description: 'Create and manage estimates within assigned accounts',
      category: 'Financial Management',
    });
  });

  it('includes both estimate permissions in Financial Management', () => {
    expect(PermissionCategories['Financial Management']).toContain(
      Permission.VIEW_ESTIMATES,
    );

    expect(PermissionCategories['Financial Management']).toContain(
      Permission.MANAGE_ESTIMATES,
    );
  });

  it('includes both estimate permissions in all permissions', () => {
    const permissions = getAllPermissions();

    expect(permissions).toContain(Permission.VIEW_ESTIMATES);
    expect(permissions).toContain(Permission.MANAGE_ESTIMATES);
  });
});
