import type { AgentEvent, Session } from '@cindy/maker-core';
import { describe, expect, it, vi } from 'vitest';

import { localUsageProviderOf, recordSessionProviderPartyUsage } from '../sessionProviderPartyUsage';

function session(overrides: Partial<Record<'id' | 'agentKind' | 'agentDeviceId' | 'remoteHostId' | 'model', unknown>> = {}): Session {
  return { id: 's1', agentKind: 'codex', agentDeviceId: null, remoteHostId: null, model: 'gpt-5.5', ...overrides } as unknown as Session;
}

const done = (usage: Record<string, number>): AgentEvent => ({ type: 'done', data: { usage } }) as unknown as AgentEvent;

describe('localUsageProviderOf', () => {
  it('records a task in a group built here under the group, wherever the Agent ran', () => {
    const binding = { providerId: 'anthropic', memberKey: 'device:studio:anthropic-2', at: 1 };
    expect(localUsageProviderOf({ binding, agentDeviceId: 'studio', remoteHostId: null, providerId: 'anthropic-2' })).toBe('anthropic');
  });

  it('records other tasks only when the Agent ran on this computer', () => {
    expect(localUsageProviderOf({ binding: null, agentDeviceId: null, remoteHostId: null, providerId: 'openai' })).toBe('openai');
    expect(localUsageProviderOf({ binding: null, agentDeviceId: 'studio', remoteHostId: null, providerId: 'openai' })).toBeNull();
    // 另一台电脑上的组：Agent 在那台运行时由那台记；分到本机运行时记在本机用的供应商上。
    const remote = { providerId: 'anthropic', memberKey: 'local', groupDeviceId: 'mini', at: 1 };
    expect(localUsageProviderOf({ binding: remote, agentDeviceId: 'mini', remoteHostId: null, providerId: 'anthropic' })).toBeNull();
    expect(localUsageProviderOf({ binding: remote, agentDeviceId: null, remoteHostId: null, providerId: 'anthropic-9' })).toBe('anthropic-9');
    expect(localUsageProviderOf({ binding: null, agentDeviceId: null, remoteHostId: 'ssh-1', providerId: 'openai' })).toBeNull();
    expect(localUsageProviderOf({ binding: null, agentDeviceId: null, remoteHostId: null, providerId: null })).toBeNull();
  });
});

describe('recordSessionProviderPartyUsage', () => {
  it('records one round per done event with its tokens', () => {
    const record = vi.fn();
    const deps = { providerOf: () => 'openai', bindingOf: () => null, record };
    const target = session();
    recordSessionProviderPartyUsage(deps, target, { type: 'text', data: {} } as unknown as AgentEvent);
    recordSessionProviderPartyUsage(deps, target, done({ promptTokens: 120, completionTokens: 30 }));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      kind: 'codex',
      providerId: 'openai',
      samples: [expect.objectContaining({ model: 'gpt-5.5', turns: 1, inputTokens: 120, outputTokens: 30 })],
    });
  });

  it('skips rounds whose Agent ran on another computer', () => {
    const record = vi.fn();
    recordSessionProviderPartyUsage(
      { providerOf: () => 'openai', bindingOf: () => null, record },
      session({ agentDeviceId: 'studio' }),
      done({ promptTokens: 1, completionTokens: 1 }),
    );
    expect(record).not.toHaveBeenCalled();
  });
});
