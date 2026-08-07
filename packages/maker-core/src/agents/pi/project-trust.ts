import type {
  PiProjectApprovalSnapshot,
  PiProjectDiscoveredResources,
  PiProjectIdentityResolution,
  PiProjectTrustCapabilities,
  PiProjectTrustDecision,
} from '../../types/pi-project-trust.js';

const DEFAULT_CAPABILITIES: PiProjectTrustCapabilities = {
  explicitSkills: true,
  projectedSettings: false,
  packagesDisabled: true,
  extensionsDisabled: true,
};

function normalizePath(value: string, platform: 'posix' | 'win32'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slash = trimmed.replaceAll('\\', '/').replace(/\/+/g, '/');
  if (platform === 'win32') {
    if (!/^(?:[A-Za-z]:\/|\/\/)/.test(slash)) return null;
    return slash.replace(/\/$/, '').toLowerCase();
  }
  if (!slash.startsWith('/')) return null;
  return slash.length > 1 ? slash.replace(/\/$/, '') : '/';
}

export function piProjectKey(
  identity: Pick<PiProjectIdentityResolution, 'canonicalWorkingDir' | 'canonicalRepoRoot' | 'platform'>,
): string | null {
  const platform = identity.platform ?? 'posix';
  const repoRoot = identity.canonicalRepoRoot && normalizePath(identity.canonicalRepoRoot, platform);
  const workingDir = identity.canonicalWorkingDir && normalizePath(identity.canonicalWorkingDir, platform);
  if (!repoRoot || !workingDir) return null;
  return `${repoRoot}\0${workingDir}`;
}

function approvalScopeKey(
  identity: Pick<PiProjectIdentityResolution, 'canonicalWorkingDir' | 'canonicalRepoRoot' | 'platform'>,
  scope: 'working-dir' | 'repo-root',
): string | null {
  const platform = identity.platform ?? 'posix';
  const repoRoot = identity.canonicalRepoRoot && normalizePath(identity.canonicalRepoRoot, platform);
  if (!repoRoot) return null;
  if (scope === 'repo-root') return repoRoot;
  const workingDir = identity.canonicalWorkingDir && normalizePath(identity.canonicalWorkingDir, platform);
  return workingDir ? `${repoRoot}\0${workingDir}` : null;
}

function normalizeApprovalScopeKey(value: string, platform: 'posix' | 'win32', scope: 'working-dir' | 'repo-root'): string | null {
  if (scope === 'repo-root') return normalizePath(value, platform);
  const separator = value.indexOf('\0');
  if (separator < 0) return null;
  const repoRoot = normalizePath(value.slice(0, separator), platform);
  const workingDir = normalizePath(value.slice(separator + 1), platform);
  return repoRoot && workingDir ? `${repoRoot}\0${workingDir}` : null;
}

function emptyDecision(
  identity: PiProjectIdentityResolution,
  status: PiProjectTrustDecision['status'],
  reason: string,
  approvalRevision: string | null,
  discovered: PiProjectDiscoveredResources,
): PiProjectTrustDecision {
  return {
    status,
    projectKey: piProjectKey(identity),
    canonicalWorkingDir: identity.canonicalWorkingDir,
    canonicalRepoRoot: identity.canonicalRepoRoot,
    approvalRevision,
    reason,
    eligibleSkillPaths: [],
    eligibleSettingsPaths: [],
    resources: {
      skills: discovered.skills.length ? 'discovered' : 'blocked',
      settings: discovered.settings.length ? 'discovered' : 'blocked',
      packages: discovered.packages.length ? 'discovered' : 'blocked',
      extensions: discovered.extensions.length ? 'discovered' : 'blocked',
    },
    launch: {
      approve: false,
      writeTrustJson: false,
      inheritUserPiHome: false,
      allowPackages: false,
      allowExtensions: false,
    },
    requiresNewSession: true,
  };
}

/**
 * Decide which discovered project resources PR4 may assemble for one session.
 * This function is intentionally fail-closed and does not claim runtime
 * `loaded`; only Pi's runtime capability manifest can make that claim.
 */
export function evaluatePiProjectTrust(input: {
  identity: PiProjectIdentityResolution;
  approval: PiProjectApprovalSnapshot | null;
  discovered: PiProjectDiscoveredResources;
  capabilities?: Partial<PiProjectTrustCapabilities>;
}): PiProjectTrustDecision {
  const { identity, approval, discovered } = input;
  if (
    identity.repoRootStatus !== 'resolved' ||
    !identity.canonicalWorkingDir ||
    !identity.canonicalRepoRoot ||
    !piProjectKey(identity)
  ) {
    return emptyDecision(identity, 'unavailable', 'project-identity-unavailable', null, discovered);
  }
  if (!approval) return emptyDecision(identity, 'unapproved', 'approval-missing', null, discovered);
  if (approval.status !== 'approved') {
    return emptyDecision(
      identity,
      approval.status,
      approval.reason ?? `approval-${approval.status}`,
      approval.revision ?? null,
      discovered,
    );
  }

  const expectedKey = approvalScopeKey(identity, approval.scope);
  const suppliedKey = normalizeApprovalScopeKey(
    approval.scopeKey,
    identity.platform ?? 'posix',
    approval.scope,
  );
  if (!expectedKey || suppliedKey !== expectedKey) {
    return emptyDecision(identity, 'unapproved', 'approval-scope-mismatch', approval.revision, discovered);
  }

  const capabilities = { ...DEFAULT_CAPABILITIES, ...input.capabilities };
  const settingsEligible = capabilities.projectedSettings && capabilities.packagesDisabled && capabilities.extensionsDisabled;
  return {
    ...emptyDecision(identity, 'approved', 'approval-matched', approval.revision, discovered),
    eligibleSkillPaths: capabilities.explicitSkills ? [...discovered.skills] : [],
    eligibleSettingsPaths: settingsEligible ? [...discovered.settings] : [],
    resources: {
      skills: capabilities.explicitSkills && discovered.skills.length ? 'eligible' : discovered.skills.length ? 'discovered' : 'blocked',
      settings: settingsEligible && discovered.settings.length ? 'eligible' : discovered.settings.length ? 'discovered' : 'blocked',
      packages: discovered.packages.length ? 'discovered' : 'blocked',
      extensions: discovered.extensions.length ? 'discovered' : 'blocked',
    },
  };
}
