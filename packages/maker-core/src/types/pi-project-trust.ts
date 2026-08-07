/**
 * Cindy-managed Pi project trust contract.
 *
 * This is deliberately a host-facing contract, not a Pi runtime manifest. It
 * contains no filesystem access and never writes trust.json or starts Pi.
 */

export type PiProjectTrustStatus =
  | 'approved'
  | 'unapproved'
  | 'revoked'
  | 'stale'
  | 'unavailable';

export type PiProjectTrustScope = 'working-dir' | 'repo-root';

export type PiProjectResourceKind = 'skills' | 'settings' | 'packages' | 'extensions';

export type PiProjectResourceDisposition = 'eligible' | 'discovered' | 'blocked';

/** Canonical paths are supplied by the host's audited resolver. */
export interface PiProjectIdentityResolution {
  workingDir: string;
  /** realpath(workingDir), or null when it cannot be resolved. */
  canonicalWorkingDir: string | null;
  /** realpath(git repository root), or null when resolution failed. */
  canonicalRepoRoot: string | null;
  /** A resolved root is required; raw git output is not sufficient. */
  repoRootStatus: 'resolved' | 'unavailable';
  platform?: 'posix' | 'win32';
}
/**
 * Result returned by Cindy's existing project-approval authority. The
 * authority owns persistence, audit history and revocation; this package only
 * consumes its immutable snapshot.
 */
export type PiProjectApprovalSnapshot =
  | {
      status: 'approved';
      scope: PiProjectTrustScope;
      scopeKey: string;
      revision: string;
      approvedAt?: string;
    }
  | {
      status: 'revoked' | 'stale';
      scope?: PiProjectTrustScope;
      scopeKey?: string;
      revision?: string;
      reason?: string;
    }
  | {
      status: 'unapproved';
      reason?: string;
    }
  | {
      status: 'unavailable';
      reason: string;
    };

export interface PiProjectDiscoveredResources {
  skills: readonly string[];
  settings: readonly string[];
  packages: readonly string[];
  extensions: readonly string[];
}

/** Capabilities proven by the pinned Pi fixture and the PR4 assembler. */
export interface PiProjectTrustCapabilities {
  /** PR4 can pass individual skill paths without enabling project trust. */
  explicitSkills: boolean;
  /** PR4 has a reviewed projection for safe project settings fields. */
  projectedSettings: boolean;
  /** Hard gate: project package installation is prevented. */
  packagesDisabled: boolean;
  /** Hard gate: project extensions are not loaded or executed. */
  extensionsDisabled: boolean;
}

export interface PiProjectTrustDecision {
  status: PiProjectTrustStatus;
  /** `${canonicalRepoRoot}\0${canonicalWorkingDir}`; null when unavailable. */
  projectKey: string | null;
  canonicalWorkingDir: string | null;
  canonicalRepoRoot: string | null;
  approvalRevision: string | null;
  reason: string;
  /** Eligible inputs for PR4. None of these means Pi reported "loaded". */
  eligibleSkillPaths: readonly string[];
  eligibleSettingsPaths: readonly string[];
  resources: Record<PiProjectResourceKind, PiProjectResourceDisposition>;
  /** Required launch policy; assembly details remain owned by PR4. */
  launch: {
    approve: false;
    writeTrustJson: false;
    inheritUserPiHome: false;
    allowPackages: false;
    allowExtensions: false;
  };
  /** Revocation/identity changes require a fresh Pi process. */
  requiresNewSession: boolean;
}
