/**
 * 供应商「按使用方」的用量账本(provider-groups.md §7)：这台电脑自己能记到的两类使用方。
 *  - 本机(`local`)：这台电脑自己的任务。Agent 在本机用这个供应商运行，或任务归本机建的供应商组
 *    (Agent 在组里哪台电脑运行都算，记在组那个供应商上)；
 *  - 我的其他电脑(`device`)：同账号其他电脑的远程 Agent 任务在这台电脑上用这个供应商运行，按那台电脑分开
 *    (含同账号的组所在电脑替它的受邀者转过来的任务)。
 * 分享的人仍记在 device-link/providerShareUsageStore。其他电脑经组直接连到别的组内电脑运行的任务，
 * 这台电脑经手不到，不在这里。
 *
 * 供应商 id 在不同账号下会重复，所以按账号存放(owners/<账号>/ 下)；原子替换写入，保留 400 天；
 * 只含供应商 id、设备 id 与模型名，不含对话或凭证。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { ownerScopedUserDataPath } from '../appSessionState.js';
import { providerShareUsageRangeStart } from '../device-link/providerShareUsageStore.js';
import type { GuestUsageSample } from '../remote-agent/host/guestUsage.js';
import type { ProviderShareUsageRange } from '../../shared/providerShare.js';

const FILE_NAME = 'provider-usage-by-party.json';
const FILE_VERSION = 1;
const RETAIN_DAYS = 400;
const MAX_ROWS = 20_000;
const FLUSH_DELAY_MS = 1_000;

/** 谁用的：本机自己的任务，或同账号的另一台电脑(设备 id)。 */
export type ProviderUsageParty = { kind: 'local' } | { kind: 'device'; deviceId: string };

interface PartyUsageRow {
  day: string;
  providerId: string;
  /** null = 本机。 */
  deviceId: string | null;
  kind: string;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  sdkCostUsd: number;
  lastAt: number;
}

export interface ProviderPartyUsage {
  /** null = 本机。 */
  deviceId: string | null;
  lastUsedAt: number;
  models: Array<Omit<PartyUsageRow, 'day' | 'providerId' | 'deviceId' | 'lastAt'>>;
}

function localDay(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isRow(value: unknown): value is PartyUsageRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const numbers = ['turns', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreateTokens', 'sdkCostUsd', 'lastAt'];
  return typeof row.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day)
    && typeof row.providerId === 'string' && row.providerId.length > 0
    && (row.deviceId === null || (typeof row.deviceId === 'string' && row.deviceId.length > 0))
    && typeof row.kind === 'string' && typeof row.model === 'string'
    && numbers.every((key) => typeof row[key] === 'number' && Number.isFinite(row[key] as number) && (row[key] as number) >= 0);
}

export function createProviderPartyUsageStore(filePath: string, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let rows: Map<string, PartyUsageRow> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  const keyOf = (row: Pick<PartyUsageRow, 'day' | 'providerId' | 'deviceId' | 'kind' | 'model'>) =>
    JSON.stringify([row.day, row.providerId, row.deviceId, row.kind, row.model]);

  function load(): Map<string, PartyUsageRow> {
    if (rows) return rows;
    rows = new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version?: unknown; rows?: unknown };
      if (parsed.version === FILE_VERSION && Array.isArray(parsed.rows)) {
        for (const row of parsed.rows) if (isRow(row)) rows.set(keyOf(row), { ...row });
      }
    } catch {
      // 没有文件或文件损坏：从空账本开始。
    }
    return rows;
  }

  function prune(map: Map<string, PartyUsageRow>): void {
    const cutoff = localDay(now() - RETAIN_DAYS * 86_400_000);
    for (const [key, row] of map) if (row.day < cutoff) map.delete(key);
    if (map.size <= MAX_ROWS) return;
    const oldest = [...map.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
    for (const [key] of oldest.slice(0, map.size - MAX_ROWS)) map.delete(key);
  }

  async function writeNow(): Promise<void> {
    const map = load();
    prune(map);
    const body = JSON.stringify({ version: FILE_VERSION, rows: [...map.values()] });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fsp.writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await fsp.rename(tmp, filePath);
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  function scheduleFlush(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      writing = writing.then(writeNow).catch(() => undefined);
    }, FLUSH_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    record(
      party: ProviderUsageParty,
      usage: { kind: string; providerId: string; samples: readonly GuestUsageSample[] },
    ): void {
      if (!usage.providerId || usage.samples.length === 0) return;
      const map = load();
      const at = now();
      const day = localDay(at);
      const deviceId = party.kind === 'device' ? party.deviceId : null;
      for (const sample of usage.samples) {
        const identity = { day, providerId: usage.providerId, deviceId, kind: usage.kind, model: sample.model };
        const key = keyOf(identity);
        const row = map.get(key) ?? {
          ...identity, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, sdkCostUsd: 0, lastAt: at,
        };
        row.turns += sample.turns;
        row.inputTokens += sample.inputTokens;
        row.outputTokens += sample.outputTokens;
        row.cacheReadTokens += sample.cacheReadTokens;
        row.cacheCreateTokens += sample.cacheCreateTokens;
        row.sdkCostUsd += sample.sdkCostUsd;
        row.lastAt = at;
        map.set(key, row);
      }
      scheduleFlush();
    },

    /** 某个供应商按使用方汇总：本机一项(没用过时为 null)，其他电脑每台一项。最近使用时间不受时间段限制。 */
    query(providerId: string, range: ProviderShareUsageRange): { local: ProviderPartyUsage | null; devices: ProviderPartyUsage[] } {
      const start = providerShareUsageRangeStart(range, now());
      const parties = new Map<string, ProviderPartyUsage>();
      for (const row of load().values()) {
        if (row.providerId !== providerId) continue;
        const partyKey = row.deviceId ?? '';
        const party = parties.get(partyKey) ?? { deviceId: row.deviceId, lastUsedAt: 0, models: [] };
        parties.set(partyKey, party);
        party.lastUsedAt = Math.max(party.lastUsedAt, row.lastAt);
        if (start && row.day < start) continue;
        const model = party.models.find((item) => item.model === row.model && item.kind === row.kind);
        if (model) {
          model.turns += row.turns;
          model.inputTokens += row.inputTokens;
          model.outputTokens += row.outputTokens;
          model.cacheReadTokens += row.cacheReadTokens;
          model.cacheCreateTokens += row.cacheCreateTokens;
          model.sdkCostUsd += row.sdkCostUsd;
        } else {
          party.models.push({
            kind: row.kind,
            model: row.model,
            turns: row.turns,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheCreateTokens: row.cacheCreateTokens,
            sdkCostUsd: row.sdkCostUsd,
          });
        }
      }
      for (const party of parties.values()) party.models.sort((a, b) => b.turns - a.turns || a.model.localeCompare(b.model));
      const local = parties.get('') ?? null;
      parties.delete('');
      return { local, devices: [...parties.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt) };
    },

    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        writing = writing.then(writeNow).catch(() => undefined);
      }
      await writing;
    },
  };
}

export type ProviderPartyUsageStore = ReturnType<typeof createProviderPartyUsageStore>;

const stores = new Map<string, ProviderPartyUsageStore>();

/** 当前账号的账本；登录前是进程临时目录里的空账本(不读写任何账号的数据)。 */
export function currentProviderPartyUsageStore(): ProviderPartyUsageStore {
  const filePath = ownerScopedUserDataPath(FILE_NAME);
  let store = stores.get(filePath);
  if (!store) {
    store = createProviderPartyUsageStore(filePath);
    stores.set(filePath, store);
  }
  return store;
}

/** 退出前把各账号还没写盘的用量写完。 */
export async function flushProviderPartyUsage(): Promise<void> {
  await Promise.all([...stores.values()].map((store) => store.flush()));
}
