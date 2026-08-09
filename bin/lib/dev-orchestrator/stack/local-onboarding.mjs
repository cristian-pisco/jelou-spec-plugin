export function keyringIdentity(workspaceId, taskSlug) {
  return `jlu-local-auth:${workspaceId}:${taskSlug}`;
}

function completeProfile(profile) {
  return Boolean(profile?.workspaceId && profile?.taskSlug && profile?.company && profile?.user?.name && profile?.user?.email && profile?.keyringIdentity);
}

function requireText(value, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
}

function validateCompany(company) {
  if (!['existing', 'new'].includes(company?.mode)) throw new Error('company mode must be existing or new');
  if (company.mode === 'existing') {
    if (company.id !== undefined && (!Number.isInteger(company.id) || company.id < 1)) throw new Error('existing company id must be a positive integer');
    return;
  }
  requireText(company.name, 'company name is required');
  if (!['ENTERPRISE', 'SELF_SERVICE'].includes(company.plan)) throw new Error('company plan must be ENTERPRISE or SELF_SERVICE');
}

function validateUser(user) {
  requireText(user?.name, 'user name is required');
  if (typeof user.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) throw new Error('user email is invalid');
  requireText(user.password, 'user password is required');
}

export function resolveOnboardingProfile({ workspaceId, taskSlug, input, storedProfile, reconfigure = false }) {
  requireText(workspaceId, 'workspace identity is required');
  requireText(taskSlug, 'task slug is required');
  const expectedIdentity = keyringIdentity(workspaceId, taskSlug);
  const scopeMismatch = storedProfile && (
    (storedProfile.workspaceId && storedProfile.workspaceId !== workspaceId)
    || (storedProfile.taskSlug && storedProfile.taskSlug !== taskSlug)
    || (storedProfile.keyringIdentity && storedProfile.keyringIdentity !== expectedIdentity)
  );
  if (scopeMismatch) throw new Error(`stored profile does not belong to ${workspaceId}/${taskSlug}`);
  if (reconfigure && !input) throw new Error('reconfiguration input is required');
  if (!input && completeProfile(storedProfile)) return { action: 'reuse', profile: storedProfile };
  const selectedCompany = input.company || storedProfile?.company;
  const user = { ...storedProfile?.user, ...input.user };
  validateCompany(selectedCompany);
  validateUser(user);
  const company = selectedCompany.mode === 'new'
    ? { mode: 'new', name: selectedCompany.name, plan: selectedCompany.plan }
    : { mode: 'existing', id: selectedCompany.id || 135 };
  return {
    action: 'provision',
    profile: {
      workspaceId,
      taskSlug,
      company,
      user: { name: user.name, email: user.email },
      keyringIdentity: expectedIdentity,
    },
    password: user.password,
  };
}
