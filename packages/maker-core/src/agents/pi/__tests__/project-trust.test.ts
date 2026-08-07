import { describe, expect, it } from 'vitest';

import { evaluatePiProjectTrust, piProjectKey } from '../project-trust.js';
import type {
  PiProjectApprovalSnapshot,
  PiProjectDiscoveredResources,
  PiProjectIdentityResolution,
} from '../../../types/pi-project-trust.js';

const identity: PiProjectIdentityResolution = {
  workingDir: '/repo/packages/app',
  canonicalWorkingDir: '/repo/packages/app',
  canonicalRepoRoot: '/repo',
  repoRootStatus: 'resolved',
  platform: 'posix',
};

const discovered: PiProjectDiscoveredResources = {
  skills: ['/repo/.pi/skills/a', '/repo/.agents/skills/b'],
  settings: ['/repo/.pi/settings.json'],
  packages: ['/repo/.pi/package.json'],
  extensions: ['/repo/.pi/extensions/x.ts'],
};

const approval = (overrides: Partial<Extract<PiProjectApprovalSnapshot, { status: 'approved' }>> = {}): PiProjectApprovalSnapshot => ({
  status: 'approved',
  scope: 'working-dir',
  scopeKey: '/repo\0/repo/packages/app',
  revision: 'rev-1',
  ...overrides,
});

describe('Pi project trust contract', () => {
  it('uses canonical repo root + workingDir and isolates sibling workingDirs', () => {
    expect(piProjectKey(identity)).toBe('/repo\0/repo/packages/app');
    expect(evaluatePiProjectTrust({ identity, approval: approval(), discovered }).status).toBe('approved');
    expect(evaluatePiProjectTrust({
      identity: { ...identity, canonicalWorkingDir: '/repo/packages/other' },
      approval: approval(),
      discovered,
    }).status).toBe('unapproved');
  });

  it('allows explicit skills only; settings/packages/extensions stay separated', () => {
    const result = evaluatePiProjectTrust({ identity, approval: approval(), discovered });
    expect(result.eligibleSkillPaths).toEqual(discovered.skills);
    expect(result.eligibleSettingsPaths).toEqual([]);
    expect(result.resources).toEqual({
      skills: 'eligible', settings: 'discovered', packages: 'discovered', extensions: 'discovered',
    });
    expect(result.launch).toEqual({
      approve: false,
      writeTrustJson: false,
      inheritUserPiHome: false,
      allowPackages: false,
      allowExtensions: false,
    });
  });

  it.each([
    ['missing', null, 'unapproved', 'approval-missing'],
    ['unapproved', { status: 'unapproved', reason: 'user-denied' } as PiProjectApprovalSnapshot, 'unapproved', 'user-denied'],
    ['revoked', { status: 'revoked', revision: 'revoked-2', reason: 'user-revoked' } as PiProjectApprovalSnapshot, 'revoked', 'user-revoked'],
    ['stale', { status: 'stale', revision: 'stale-2', reason: 'revision-old' } as PiProjectApprovalSnapshot, 'stale', 'revision-old'],
    ['unavailable', { status: 'unavailable', reason: 'store-offline' } as PiProjectApprovalSnapshot, 'unavailable', 'store-offline'],
  ])('fails closed for %s approval', (_label, input, status, reason) => {
    const result = evaluatePiProjectTrust({ identity, approval: input, discovered });
    expect(result.status).toBe(status);
    expect(result.reason).toBe(reason);
    expect(result.eligibleSkillPaths).toEqual([]);
  });

  it('keeps revoked/stale approval revisions as audit evidence', () => {
    expect(evaluatePiProjectTrust({
      identity,
      approval: { status: 'revoked', revision: 'revoked-2', reason: 'user-revoked' },
      discovered,
    }).approvalRevision).toBe('revoked-2');
    expect(evaluatePiProjectTrust({
      identity,
      approval: { status: 'stale', revision: 'stale-2', reason: 'revision-old' },
      discovered,
    }).approvalRevision).toBe('stale-2');
  });

  it('fails closed when realpath or repository root resolution is unavailable', () => {
    const result = evaluatePiProjectTrust({
      identity: { ...identity, canonicalRepoRoot: null, repoRootStatus: 'unavailable' },
      approval: approval(),
      discovered,
    });
    expect(result.status).toBe('unavailable');
    expect(result.resources.skills).toBe('discovered');
  });

  it('supports explicit repo-root approval for multiple workingDirs', () => {
    const repoApproval = approval({ scope: 'repo-root', scopeKey: '/repo' });
    expect(evaluatePiProjectTrust({
      identity: { ...identity, canonicalWorkingDir: '/repo/packages/other' },
      approval: repoApproval,
      discovered,
    }).status).toBe('approved');
  });

  it('normalizes symlink/realpath and Windows case/separators before matching', () => {
    const result = evaluatePiProjectTrust({
      identity: {
        ...identity,
        canonicalWorkingDir: 'C:/Repo/App',
        canonicalRepoRoot: 'C:/Repo',
        workingDir: 'C:\\repo\\app',
        platform: 'win32',
      },
      approval: approval({ scopeKey: 'c:/repo\0c:/repo/app' }),
      discovered,
    });
    expect(result.status).toBe('approved');
  });

  it('does not let concurrent session inputs leak into one another', () => {
    const first = evaluatePiProjectTrust({ identity, approval: approval({ revision: 'a' }), discovered });
    const second = evaluatePiProjectTrust({
      identity: { ...identity, canonicalWorkingDir: '/repo/other' },
      approval: approval({ scopeKey: '/repo\0/repo/other', revision: 'b' }),
      discovered: { ...discovered, skills: ['/repo/other/.pi/skills/c'] },
    });
    expect(first.approvalRevision).toBe('a');
    expect(first.eligibleSkillPaths).toEqual(discovered.skills);
    expect(second.approvalRevision).toBe('b');
    expect(second.eligibleSkillPaths).toEqual(['/repo/other/.pi/skills/c']);
  });
});
