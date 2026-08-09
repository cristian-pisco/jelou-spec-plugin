import { resolveOnboardingProfile } from './local-onboarding.mjs';
import { proveLocalDatabaseTarget } from './local-target.mjs';

function localIdentity(profile) {
  return profile.keyringIdentity;
}

async function reconcileGraph(tx, profile, passwordHash, owner) {
  await tx.ensureCompanyPlan('SELF_SERVICE');
  const profileIdentity = localIdentity(profile);
  const companyInput = {
    id: profile.company.mode === 'existing' ? profile.company.id : `${profileIdentity}:company`,
    profileIdentity,
    name: profile.company.name,
    plan: profile.company.plan,
    existing: profile.company.mode === 'existing',
  };
  if (profile.company.mode === 'new') companyInput.owner = owner;
  const company = await tx.reconcileCompany(companyInput);
  const chatbot = await tx.reconcileChatbot({ id: `${profileIdentity}:chatbot`, companyId: company.id, owner });
  const user = await tx.reconcileUser({
    id: `${profileIdentity}:user`,
    name: profile.user.name,
    email: profile.user.email,
    passwordHash,
    active: true,
    emailVerified: true,
    owner,
  });
  const relationIdentity = `${company.id}:${user.id}`;
  const access = await tx.reconcileAccess({ identity: relationIdentity, companyId: company.id, userId: user.id, required: true, owner });
  const operator = await tx.reconcileOperator({ identity: relationIdentity, companyId: company.id, userId: user.id, active: true, owner });
  const role = await tx.reconcileRole({ identity: `${relationIdentity}:LOCAL_DEVELOPER`, companyId: company.id, userId: user.id, roleKey: 'LOCAL_DEVELOPER', owner });
  const twoFactor = await tx.reconcileTwoFactor({ userId: user.id, required: false, owner });
  return { company, chatbot, user, access, operator, role, twoFactor };
}

async function restoreCredential(keyring, identity, previousPassword) {
  if (previousPassword === null) keyring.remove(identity);
  else keyring.replace(identity, previousPassword);
}

function cleanupResources(graph, identity, owner, cleanupDescriptor) {
  const resources = [{ kind: 'credential', resource: { identity, profileIdentity: identity, owner } }];
  for (const [entity, record] of Object.entries(graph)) {
    if (record?.owner?.profileIdentity !== identity) continue;
    resources.push({
      kind: 'testData',
      resource: {
        entity,
        id: record.id || record.identity || record.userId,
        profileIdentity: identity,
        owner: record.owner,
        ...(cleanupDescriptor || {}),
      },
    });
  }
  return resources;
}

export async function onboardLocalAuth(options, { keyring, database, bcrypt }) {
  const resolved = resolveOnboardingProfile(options);
  if (!keyring.isAvailable()) throw new Error('operating-system keyring unavailable; install and unlock a supported keyring, then retry');
  const targetProof = proveLocalDatabaseTarget(options.target, options.topology);
  const identity = resolved.profile.keyringIdentity;
  const previousPassword = keyring.read(identity);
  if (resolved.action === 'reuse') {
    if (previousPassword === null) throw new Error('stored local-auth profile credential is missing; rerun with --reconfigure');
    return { status: 'reused', profile: resolved.profile, targetProof };
  }
  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(resolved.password);
  } catch {
    throw new Error('bcrypt password hashing failed');
  }
  keyring.replace(identity, resolved.password);
  try {
    const owner = {
      workspaceId: options.workspaceId,
      taskSlug: options.taskSlug,
      runId: options.runId,
      profileIdentity: identity,
    };
    const provisioned = await database.transaction(async (tx) => ({
      graph: await reconcileGraph(tx, resolved.profile, passwordHash, owner),
    }));
    return {
      status: 'provisioned',
      profile: resolved.profile,
      targetProof,
      ...provisioned,
      cleanupResources: cleanupResources(provisioned.graph, identity, owner, database.cleanupDescriptor),
    };
  } catch (error) {
    try {
      await restoreCredential(keyring, identity, previousPassword);
    } catch {
      throw new Error('local auth provisioning failed and keyring restoration needs manual remediation', { cause: error });
    }
    throw new Error('local auth provisioning failed; the previous usable keyring profile was restored', { cause: error });
  }
}
