import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../appSessionState.js', () => ({
  ownerScopedUserDataPath: (...parts: string[]) => path.join(owner.dir, ...parts),
}));

import {
  createProviderPartyUsageStore,
  currentProviderPartyUsageStore,
  flushProviderPartyUsage,
} from '../providerPartyUsageStore';

const sample = (model: string, input: number, output: number, turns = 1) => ({
  model, turns, inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheCreateTokens: 0, sdkCostUsd: 0,
});

describe('provider party usage store', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-party-usage-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('splits one provider into this computer and each other computer, by range', async () => {
    let now = new Date(2026, 9, 7, 12).getTime();
    const file = path.join(dir, 'usage.json');
    const store = createProviderPartyUsageStore(file, { now: () => now });
    store.record({ kind: 'local' }, { kind: 'claude-code', providerId: 'anthropic', samples: [sample('opus', 10, 5)] });
    store.record({ kind: 'device', deviceId: 'studio' }, { kind: 'claude-code', providerId: 'anthropic', samples: [sample('opus', 7, 3)] });
    // 别的供应商不混进来。
    store.record({ kind: 'local' }, { kind: 'codex', providerId: 'openai', samples: [sample('gpt', 1, 1)] });
    now = new Date(2026, 8, 20, 12).getTime();
    store.record({ kind: 'local' }, { kind: 'claude-code', providerId: 'anthropic', samples: [sample('opus', 100, 50)] });
    now = new Date(2026, 9, 7, 13).getTime();

    const month = store.query('anthropic', 'month');
    expect(month.local).toMatchObject({ deviceId: null, lastUsedAt: new Date(2026, 9, 7, 12).getTime() });
    expect(month.local?.models).toEqual([
      { kind: 'claude-code', model: 'opus', turns: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0, sdkCostUsd: 0 },
    ]);
    expect(month.devices).toHaveLength(1);
    expect(month.devices[0]).toMatchObject({ deviceId: 'studio' });
    expect(store.query('anthropic', 'all').local?.models[0]).toMatchObject({ turns: 2, inputTokens: 110, outputTokens: 55 });
    expect(store.query('xai', 'all')).toEqual({ local: null, devices: [] });

    await store.flush();
    const reloaded = createProviderPartyUsageStore(file, { now: () => now });
    expect(reloaded.query('anthropic', 'all').devices[0]?.models[0]).toMatchObject({ inputTokens: 7 });
    expect(reloaded.query('openai', 'all').local?.models[0]).toMatchObject({ model: 'gpt' });
  });

  it('ignores rounds without a provider and malformed rows', () => {
    const file = path.join(dir, 'usage.json');
    const store = createProviderPartyUsageStore(file);
    store.record({ kind: 'local' }, { kind: 'pi', providerId: '', samples: [sample('x', 1, 1)] });
    expect(store.query('', 'all')).toEqual({ local: null, devices: [] });
    fs.writeFileSync(file, JSON.stringify({ version: 1, rows: [{ day: '2026-10-01', providerId: 'p', deviceId: '', kind: 'pi', model: 'x', turns: 1 }] }));
    expect(createProviderPartyUsageStore(file).query('p', 'all')).toEqual({ local: null, devices: [] });
  });

  it('keeps one ledger per account', async () => {
    owner.dir = path.join(dir, 'owner-a');
    currentProviderPartyUsageStore().record({ kind: 'local' }, { kind: 'pi', providerId: 'anthropic', samples: [sample('m', 1, 1)] });
    owner.dir = path.join(dir, 'owner-b');
    expect(currentProviderPartyUsageStore().query('anthropic', 'all').local).toBeNull();
    await flushProviderPartyUsage();
    expect(fs.existsSync(path.join(dir, 'owner-a', 'provider-usage-by-party.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'owner-b', 'provider-usage-by-party.json'))).toBe(false);
  });
});
