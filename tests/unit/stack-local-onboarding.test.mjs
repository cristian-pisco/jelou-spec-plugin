import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveOnboardingProfile } from '../../bin/lib/dev-orchestrator/stack/local-onboarding.mjs';

describe('local onboarding profile', () => {
  test('existing-company onboarding defaults to company 135 and returns reusable metadata', () => {
    const result = resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      input: {
        company: { mode: 'existing' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    });

    assert.deepEqual(result, {
      action: 'provision',
      profile: {
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        company: { mode: 'existing', id: 135 },
        user: { name: 'Local Developer', email: 'local@example.test' },
        keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
      },
      password: 'secret-value',
    });
  });

  test('new-company onboarding preserves ENTERPRISE and SELF_SERVICE plans', () => {
    for (const plan of ['ENTERPRISE', 'SELF_SERVICE']) {
      const result = resolveOnboardingProfile({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        input: {
          company: { mode: 'new', name: 'Local Workspace', plan },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
        },
      });

      assert.deepEqual(result.profile.company, { mode: 'new', name: 'Local Workspace', plan });
    }
  });

  test('a complete stored profile is reused without requesting a password', () => {
    const storedProfile = {
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      company: { mode: 'existing', id: 135 },
      user: { name: 'Local Developer', email: 'local@example.test' },
      keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
    };

    assert.deepEqual(resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      storedProfile,
    }), { action: 'reuse', profile: storedProfile });
  });

  test('stored metadata from another workspace or task is never reused', () => {
    const storedProfile = {
      workspaceId: 'workspace-b',
      taskSlug: 'task-b',
      company: { mode: 'existing', id: 135 },
      user: { name: 'Local Developer', email: 'local@example.test' },
      keyringIdentity: 'jlu-local-auth:workspace-b:task-b',
    };

    assert.throws(() => resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      storedProfile,
    }), /stored profile does not belong to workspace-a\/task-a/);
  });

  test('an incomplete profile resumes with only its missing values', () => {
    const result = resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      storedProfile: {
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        company: { mode: 'existing', id: 135 },
        user: { name: 'Stored Name' },
      },
      input: { user: { email: 'local@example.test', password: 'secret-value' } },
    });

    assert.deepEqual(result.profile, {
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      company: { mode: 'existing', id: 135 },
      user: { name: 'Stored Name', email: 'local@example.test' },
      keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
    });
  });

  test('reconfiguration replaces stored company user and password selections', () => {
    const result = resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      reconfigure: true,
      storedProfile: {
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        company: { mode: 'existing', id: 135 },
        user: { name: 'Old Name', email: 'old@example.test' },
        keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
      },
      input: {
        company: { mode: 'new', name: 'Replacement Company', plan: 'SELF_SERVICE' },
        user: { name: 'New Name', email: 'new@example.test', password: 'new-secret' },
      },
    });

    assert.equal(result.action, 'provision');
    assert.deepEqual(result.profile.company, { mode: 'new', name: 'Replacement Company', plan: 'SELF_SERVICE' });
    assert.deepEqual(result.profile.user, { name: 'New Name', email: 'new@example.test' });
    assert.equal(result.password, 'new-secret');
  });

  test('reconfiguration never silently reuses a complete stored profile', () => {
    assert.throws(() => resolveOnboardingProfile({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      reconfigure: true,
      storedProfile: {
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        company: { mode: 'existing', id: 135 },
        user: { name: 'Stored Name', email: 'stored@example.test' },
        keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
      },
    }), /reconfiguration input is required/);
  });

  test('invalid onboarding fields are rejected with one diagnostic per violated rule', () => {
    const valid = {
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      input: {
        company: { mode: 'new', name: 'Local Company', plan: 'ENTERPRISE' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    };
    const cases = [
      [{ ...valid, workspaceId: '' }, /workspace identity is required/],
      [{ ...valid, taskSlug: '' }, /task slug is required/],
      [{ ...valid, input: { ...valid.input, company: { ...valid.input.company, mode: 'shared' } } }, /company mode must be existing or new/],
      [{ ...valid, input: { ...valid.input, company: { mode: 'existing', id: 0 } } }, /existing company id must be a positive integer/],
      [{ ...valid, input: { ...valid.input, company: { ...valid.input.company, name: '  ' } } }, /company name is required/],
      [{ ...valid, input: { ...valid.input, company: { ...valid.input.company, plan: 'POCKET' } } }, /company plan must be ENTERPRISE or SELF_SERVICE/],
      [{ ...valid, input: { ...valid.input, user: { ...valid.input.user, name: '' } } }, /user name is required/],
      [{ ...valid, input: { ...valid.input, user: { ...valid.input.user, email: 'not-an-email' } } }, /user email is invalid/],
      [{ ...valid, input: { ...valid.input, user: { ...valid.input.user, password: '' } } }, /user password is required/],
    ];

    for (const [input, expected] of cases) assert.throws(() => resolveOnboardingProfile(input), expected);
  });
});
