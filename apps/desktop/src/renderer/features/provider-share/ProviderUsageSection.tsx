/**
 * 「远程与分享」页的「用量」块(供应商组 §7、§10)：按使用方列出这个供应商的用量——本机、我的其他电脑
 * (按电脑分开)、分享的人(按人分开)，共用一个时间段切换，每行可展开按模型的明细。
 *
 * 本机与我的其他电脑来自这台电脑自己的账本(main 的 own-usage)，分享的人来自分享服务的成员用量；
 * 其他电脑经供应商组直接连到别的组内电脑运行的任务这台电脑经手不到，不在这里。
 */
import { ChevronRight, Monitor } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { Tip } from '@/components/ui/tooltip';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { formatModelShort } from '@/lib/usageFormat';
import { cn } from '@/lib/utils';

import type {
  ProviderOwnUsageView,
  ProviderShareMemberView,
  ProviderShareModelUsageView,
  ProviderShareUsageRange,
} from '../../../shared/providerShare';
import { formatShareMoney, formatShareTokens, summarizeShareUsage } from './providerShareFormat';
import { ShareAvatar } from './ShareAvatar';
import type { ShareTimeFormat } from './useShareTimeFormat';

const RANGES: readonly ProviderShareUsageRange[] = ['7d', 'month', 'all'];

interface UsageParty {
  key: string;
  name: string;
  source: string | null;
  /** 分享的人用头像，电脑用设备图标。 */
  person?: { displayName: string; avatarUrl?: string | null };
  lastUsedAt: number | null;
  models: ProviderShareModelUsageView[];
}

export function ProviderUsageSection({
  providerName,
  own,
  ownFailed,
  members,
  membersLoading,
  selfDeviceName,
  range,
  onRangeChange,
  time,
}: {
  providerName: string;
  /** null = 还没读到。 */
  own: ProviderOwnUsageView | null;
  ownFailed: boolean;
  members: readonly ProviderShareMemberView[];
  /** 分享服务的成员还没读到。 */
  membersLoading: boolean;
  selfDeviceName: string | null;
  range: ProviderShareUsageRange;
  onRangeChange: (range: ProviderShareUsageRange) => void;
  time: ShareTimeFormat;
}) {
  const { t } = useTranslation();
  const devices = useDeviceLinkDeviceList();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const parties = useMemo<UsageParty[]>(() => {
    const rows: UsageParty[] = [];
    // 本机一行总在，没用过也写出来：这一块就是要看得到自己的用量。
    if (own || ownFailed) {
      rows.push({
        key: 'local',
        name: t('providerGroup.member.local'),
        source: selfDeviceName,
        lastUsedAt: own?.local?.lastUsedAt ?? null,
        models: own?.local?.models ?? [],
      });
    }
    for (const party of own?.devices ?? []) {
      if (!party.deviceId) continue;
      rows.push({
        key: `device:${party.deviceId}`,
        name:
          devices?.find((device) => device.deviceId === party.deviceId)?.name ||
          party.deviceName ||
          t('providerGroup.usage.unknownDevice'),
        source: t('providerGroup.member.sourceDevice'),
        lastUsedAt: party.lastUsedAt,
        models: party.models,
      });
    }
    for (const member of members) {
      rows.push({
        key: `member:${member.memberId}`,
        name: member.displayName,
        source: t('providerGroup.usage.shareSource'),
        person: { displayName: member.displayName, avatarUrl: member.avatarUrl },
        lastUsedAt: member.lastUsedAt,
        models: member.models,
      });
    }
    return rows;
  }, [devices, members, own, ownFailed, selfDeviceName, t]);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="mt-8 shrink-0" aria-labelledby="provider-usage-title">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <h3 id="provider-usage-title" className="text-13 font-medium text-[var(--settings-section-title)]">
            {t('providerGroup.usage.title')}
          </h3>
          <p className="text-12 leading-[1.5] text-[var(--settings-section-desc)]">
            {t('providerGroup.usage.description', { provider: providerName })}
          </p>
        </div>
        <SegmentedControl
          value={range}
          onValueChange={onRangeChange}
          aria-label={t('providerShare.manage.members.rangeAria')}
          options={RANGES.map((value) => ({ value, label: t(`providerShare.manage.members.range.${value}`) }))}
        />
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
        {parties.length === 0 ? (
          <p className="px-4 py-7 text-center text-13 leading-[1.5] text-[var(--text-secondary)]">
            {membersLoading || !own ? t('providerShare.manage.loading') : '—'}
          </p>
        ) : (
          parties.map((party, index) => (
            <UsagePartyRow
              key={party.key}
              party={party}
              first={index === 0}
              open={expanded.has(party.key)}
              unavailable={party.key === 'local' && ownFailed && !own}
              time={time}
              onToggle={() => toggle(party.key)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function UsagePartyRow({
  party,
  first,
  open,
  unavailable,
  time,
  onToggle,
}: {
  party: UsageParty;
  first: boolean;
  open: boolean;
  /** 本机账本没读出来：不写 0，免得被当成没用过。 */
  unavailable: boolean;
  time: ShareTimeFormat;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const totals = summarizeShareUsage(party.models);
  const breakdownId = `provider-usage-${party.key}`;
  const toggleLabel = t(open ? 'providerShare.manage.members.collapseAria' : 'providerShare.manage.members.expandAria', {
    name: party.name,
  });
  return (
    <div
      data-testid="provider-usage-row"
      data-usage-party={party.key}
      className={cn(!first && 'border-t border-[var(--settings-theme-card-border)]')}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Tip text={toggleLabel}>
          <button
            type="button"
            onClick={onToggle}
            disabled={unavailable}
            aria-expanded={open}
            aria-controls={breakdownId}
            aria-label={toggleLabel}
            className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50"
          >
            <ChevronRight
              size={14}
              aria-hidden
              className={cn('transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')}
            />
          </button>
        </Tip>
        {party.person ? (
          <ShareAvatar displayName={party.person.displayName} avatarUrl={party.person.avatarUrl} />
        ) : (
          // 电脑用设备图标(与上方组内电脑一致)；人像头像留给分享的人。
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-chip)] text-[var(--text-secondary)]"
          >
            <Monitor size={16} />
          </span>
        )}
        <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2 text-13">
            <span className="font-medium text-[var(--text-primary)]">{party.name}</span>
            {party.source && <span className="text-12 text-[var(--text-secondary)]">{party.source}</span>}
          </div>
          <span className="text-12 text-[var(--text-secondary)]">
            {unavailable
              ? t('providerShare.manage.loadFailed')
              : party.lastUsedAt
                ? t('providerShare.manage.members.lastUsed', { time: time.relative(party.lastUsedAt) })
                : t('providerShare.manage.members.neverUsed')}
          </span>
        </div>
        {!unavailable && (
          <div className="flex shrink-0 flex-col items-end text-12 text-[var(--text-secondary)]">
            <span className="text-13 font-medium text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
              {t('providerShare.manage.members.tokens', { tokens: formatShareTokens(totals.tokens) })}
            </span>
            {totals.amount && (
              <span className="[font-variant-numeric:tabular-nums]">
                {t('providerShare.manage.members.amount', { amount: formatShareMoney(totals.amount) })}
              </span>
            )}
          </div>
        )}
      </div>
      {/* 明细表与头像左缘对齐：px-4 + 展开按钮(24 - 4) + gap-3 = 48px。 */}
      {open && !unavailable && (
        <div id={breakdownId} className="px-4 pb-3.5 sm:pl-12">
          <table className="w-full border-collapse text-12">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-left text-[var(--text-secondary)]">
                <th scope="col" className="py-1.5 pr-3 font-medium">{t('providerShare.manage.members.table.model')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t('providerShare.manage.members.table.turns')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t('providerShare.manage.members.table.input')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">{t('providerShare.manage.members.table.output')}</th>
                <th scope="col" className="py-1.5 text-right font-medium">{t('providerShare.manage.members.table.amount')}</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
              {party.models.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-2 text-[var(--text-secondary)]">
                    {t('providerShare.manage.members.noUsage')}
                  </td>
                </tr>
              ) : (
                party.models.map((model) => (
                  <tr
                    key={`${model.kind}:${model.providerId ?? ''}:${model.model}`}
                    className="border-b border-[var(--border-default)] last:border-b-0"
                  >
                    <td className="py-1.5 pr-3">{formatModelShort(model.model)}</td>
                    <td className="py-1.5 pr-3 text-right">{model.turns}</td>
                    <td className="py-1.5 pr-3 text-right">{formatShareTokens(model.inputTokens)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatShareTokens(model.outputTokens)}</td>
                    <td className="py-1.5 text-right">{model.amount ? formatShareMoney(model.amount) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="mt-2 text-12 text-[var(--text-tertiary)]">{t('providerShare.manage.members.estimateNote')}</p>
        </div>
      )}
    </div>
  );
}
