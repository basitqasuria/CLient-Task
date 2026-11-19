
import { describe, expect, it } from 'vitest';
import { isValidUUID, validateUUID } from '@/lib/validation-helpers';

describe('UUID validation', () => {
  it('accepts a valid UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';

    expect(isValidUUID(uuid)).toBe(true);
    expect(validateUUID(uuid)).toBe(uuid);
  });

  it('rejects an invalid UUID', () => {
    const invalidUUID = 'not-a-valid-uuid';

    expect(isValidUUID(invalidUUID)).toBe(false);
    expect(validateUUID(invalidUUID)).toBeNull();
  });

  it('rejects an incomplete UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4')).toBe(false);
  });

  it('accepts uppercase UUID characters', () => {
    expect(
      isValidUUID('550E8400-E29B-41D4-A716-446655440000'),
    ).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidUUID('')).toBe(false);
    expect(validateUUID('')).toBeNull();
  });
});
