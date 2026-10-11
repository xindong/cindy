/**
 * 「{供应商} · 远程与分享」页(供应商分享 §7.2；供应商组 §10)。从设置 → 模型供应商「允许被远程调用」一行的
 * 「远程与分享」入口进入，可返回。只列**这台电脑**上的设置：供应商组、按使用方的用量、待审批申请与已分享的人。
 *
 * 打开期间每次 OWNED_CHANGED 都按当前时间段重读(main 因此保持快速拉取，申请能尽快出现)；
 * 关闭、恢复、删除、同意、拒绝都立即生效，结果以 toast 说明。
 */
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { mapIpcErrorToI18nKey } from '@/utils/ipcError';
import { ProviderGroupSection } from '@/features/provider-group/ProviderGroupSection';

import type {
  ProviderOwnUsageView,
  ProviderShareMemberView,
  ProviderShareOwnerState,
  ProviderShareUsageRange,
} from '../../../shared/providerShare';
import { ProviderShareLinkDialog } from './ProviderShareLinkDialog';
import type { ProviderShareGate, ProviderSharePendingRequest } from './providerShareFormat';
import { ProviderUsageSection } from './ProviderUsageSection';
import { publishProviderShareOwnerState, removeProviderSharePendingRequest } from './providerShareStore';
import { ShareAvatar } from './ShareAvatar';
import { useShareTimeFormat } from './useShareTimeFormat';

export type { ProviderShareGate };

export function ProviderShareManagePage({
  providerId,
  providerName,
  providerIcon,
  gate,
  onBack,
}: {
  providerId: string;
  providerName: string;
  providerIcon: ReactNode;
  gate: ProviderShareGate;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const time = useShareTimeFormat();
  const selfDeviceName = useDeviceLinkDeviceList()?.find((device) => device.isSelf)?.name ?? null;
  const [range, setRange] = useState<ProviderShareUsageRange>('month');
  const [state, setState] = useState<ProviderShareOwnerState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [own, setOwn] = useState<ProviderOwnUsageView | null>(null);
  const [ownFailed, setOwnFailed] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const loadSeq = useRef(0);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const range = rangeRef.current;
    // 本机与我的其他电脑的用量读这台电脑自己的账本，不依赖分享服务，与分享的成员一起按同一个时间段读。
    const [owned, ownUsage] = await Promise.allSettled([
      window.electronAPI.providerShare.command({ action: 'owned', range }),
      window.electronAPI.providerShare.command({ action: 'own-usage', providerId, range }),
    ]);
    if (seq !== loadSeq.current) return;
    if (owned.status === 'fulfilled') {
      setState(owned.value);
      setLoadFailed(false);
      publishProviderShareOwnerState(owned.value);
    } else {
      setLoadFailed(true);
    }
    if (ownUsage.status === 'fulfilled') {
      setOwn(ownUsage.value);
      setOwnFailed(false);
    } else {
      setOwnFailed(true);
    }
  }, [providerId]);

  useEffect(() => {
    void load();
  }, [load, range]);

  useEffect(() => {
    const off = window.electronAPI.providerShare.onOwnedChanged(() => void load());
    return () => {
      off();
      loadSeq.current += 1;
    };
  }, [load]);

  // 同一个供应商在这台电脑上只应有一条分享；稳妥起见合并同供应商的全部记录。
  const { members, requests } = useMemo(() => {
    const shares = state?.ready ? state.shares.filter((share) => share.providerId === providerId) : [];
    const pending: ProviderSharePendingRequest[] = [];
    for (const share of shares) {
      for (const request of share.requests) {
        pending.push({
          request,
          share: { shareId: share.shareId, providerId: share.providerId, providerLabel: share.providerLabel },
        });
      }
    }
    pending.sort((a, b) => Date.parse(a.request.createdAt) - Date.parse(b.request.createdAt));
    return { members: shares.flatMap((share) => share.members), requests: pending };
  }, [providerId, state]);

  const withBusy = useCallback(async (key: string, run: () => Promise<void>) => {
    setBusy((current) => new Set(current).add(key));
    try {
      await run();
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const decide = useCallback(
    (item: ProviderSharePendingRequest, action: 'approve' | 'reject') =>
      withBusy(item.request.requestId, async () => {
        try {
          await window.electronAPI.providerShare.command({ action, requestId: item.request.requestId });
          removeProviderSharePendingRequest(item.request.requestId);
          toast.success(
            action === 'approve'
              ? t('providerShare.toast.approved', { name: item.request.displayName, provider: providerName })
              : t('providerShare.toast.rejected', { name: item.request.displayName }),
          );
        } catch (error) {
          toast.error(t(mapIpcErrorToI18nKey(error)));
        }
        void load();
      }),
    [load, providerName, t, withBusy],
  );

  const setMember = useCallback(
    (member: ProviderShareMemberView, status: 'pause' | 'resume' | 'remove') =>
      withBusy(member.memberId, async () => {
        try {
          await window.electronAPI.providerShare.command({ action: 'set-member', memberId: member.memberId, status });
          toast.success(
            t(
              status === 'pause'
                ? 'providerShare.toast.paused'
                : status === 'resume'
                  ? 'providerShare.toast.resumed'
                  : 'providerShare.toast.removed',
              { name: member.displayName },
            ),
          );
        } catch (error) {
          toast.error(t(mapIpcErrorToI18nKey(error)));
        }
        void load();
      }),
    [load, t, withBusy],
  );

  const removeMember = useCallback(
    async (member: ProviderShareMemberView) => {
      const ok = await confirm({
        presentation: 'standard',
        title: t('providerShare.manage.removeConfirm.title', { name: member.displayName }),
        description: t('providerShare.manage.removeConfirm.description', {
          name: member.displayName,
          provider: providerName,
        }),
        confirmText: t('providerShare.manage.removeConfirm.confirm'),
        confirmVariant: 'destructive',
      });
      if (ok) await setMember(member, 'remove');
    },
    [confirm, providerName, setMember, t],
  );

  const ready = state?.ready === true;
  const canCreateLink = gate === 'on' && ready;

  return (
    // 这一页自己滚动(设置页外层在「模型供应商」分区不滚)。始终预留滚动条槽位：展开组内电脑的配额、
    // 加载出已分享的人等让内容超过一屏时，滚动条出现不再把整页挤窄 12px(2026-10-11 用户反馈宽度跳变)。
    // 槽位用 -mr-3 挪进外层右侧留白，内容宽度与「模型供应商」卡片保持一致。
    <div
      className="-mr-3 flex h-full min-h-0 flex-col overflow-y-auto pb-8 [scrollbar-gutter:stable]"
      data-testid="provider-share-manage"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex h-8 shrink-0 items-center gap-2 self-start rounded-full px-2 text-13 font-medium text-[var(--settings-section-sublabel)] transition-colors hover:bg-sidebar-item-hover hover:text-[var(--settings-section-title)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <ArrowLeft size={16} aria-hidden />
        {t('settings.providers.title')}
      </button>

      {/* 标题已经说明这页是什么；这台电脑的名字由本机那行与下方「分享」说明承载，不在这里重复一遍。 */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--settings-integration-avatar-border)] bg-[var(--settings-integration-avatar-bg)] text-[var(--settings-integration-avatar-icon)]"
        >
          {providerIcon}
        </div>
        <h2 className="min-w-0 flex-1 text-16 font-medium leading-[1.3] text-[var(--settings-section-title)]">
          {t('providerGroup.page.title', { provider: providerName })}
        </h2>
      </div>

      <ProviderGroupSection providerId={providerId} providerName={providerName} />

      <ProviderUsageSection
        providerName={providerName}
        own={own}
        ownFailed={ownFailed}
        members={members}
        membersLoading={!state && !loadFailed}
        selfDeviceName={selfDeviceName}
        range={range}
        onRangeChange={setRange}
        time={time}
      />

      <div className="mt-8 flex shrink-0 flex-wrap items-start gap-3">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <h3 className="text-13 font-medium text-[var(--settings-section-title)]">
            {t('providerGroup.page.shareTitle')}
          </h3>
          <p className="text-12 leading-[1.5] text-[var(--settings-section-desc)]">
            {selfDeviceName
              ? t('providerShare.manage.descriptionWithDevice', { provider: providerName, device: selfDeviceName })
              : t('providerShare.manage.description', { provider: providerName })}
          </p>
        </div>
        <Button variant="cta" size="md" disabled={!canCreateLink} onClick={() => setLinkOpen(true)}>
          {t('providerShare.manage.createLink')}
        </Button>
      </div>

      {(gate !== 'on' || (state && !ready) || loadFailed) && (
        <p
          role="status"
          className="mt-4 shrink-0 rounded-lg bg-[var(--surface-chip)] px-3 py-2.5 text-12 leading-[1.5] text-[var(--text-secondary)]"
        >
          {gate === 'remote-off'
            ? t('providerShare.manage.gateRemoteControl')
            : gate === 'invocation-off'
              ? t('providerShare.manage.gateInvocation')
              : loadFailed
                ? t('providerShare.manage.loadFailed')
                : t('providerShare.manage.notReady')}
        </p>
      )}

      {requests.length > 0 && (
        <section className="mt-6 shrink-0" aria-labelledby="provider-share-pending-title">
          <h3 id="provider-share-pending-title" className="mb-2 text-13 font-medium text-[var(--settings-section-title)]">
            {t('providerShare.manage.pending.title')}
          </h3>
          <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
            {requests.map((item, index) => (
              <div
                key={item.request.requestId}
                data-testid="provider-share-pending-row"
                className={cn(
                  'flex flex-wrap items-center gap-3 px-4 py-3',
                  index > 0 && 'border-t border-[var(--settings-theme-card-border)]',
                )}
              >
                <ShareAvatar displayName={item.request.displayName} avatarUrl={item.request.avatarUrl} />
                <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-baseline gap-2 text-13">
                    <span className="font-medium text-[var(--text-primary)]">{item.request.displayName}</span>
                    <span className="text-12 text-[var(--text-secondary)]">{t('providerShare.manage.pending.applying')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-12 text-[var(--text-secondary)]">
                    <span>
                      {t('providerShare.pairing.label')}{' '}
                      <span className="select-text font-medium tracking-[0.06em] text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
                        {item.request.pairingCode}
                      </span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{t('providerShare.manage.pending.requestedAt', { time: time.relative(Date.parse(item.request.createdAt)) })}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t('providerShare.manage.pending.expiresHint')}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    compact
                    disabled={busy.has(item.request.requestId)}
                    onClick={() => void decide(item, 'reject')}
                  >
                    {t('providerShare.approve.reject')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    compact
                    disabled={busy.has(item.request.requestId)}
                    onClick={() => void decide(item, 'approve')}
                  >
                    {t('providerShare.approve.approve')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 shrink-0" aria-labelledby="provider-share-members-title">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 id="provider-share-members-title" className="text-13 font-medium text-[var(--settings-section-title)]">
            {t('providerShare.manage.members.title')}
          </h3>
          {members.length > 0 && <span className="text-13 text-[var(--text-tertiary)]">{members.length}</span>}
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
          {members.length === 0 ? (
            <p className="px-4 py-7 text-center text-13 leading-[1.5] text-[var(--text-secondary)]">
              {/* 分享服务未就绪时列表为空不代表没分享给任何人：上方提示已说明原因。 */}
              {state?.ready
                ? t('providerShare.manage.members.empty')
                : state || loadFailed
                  ? '—'
                  : t('providerShare.manage.loading')}
            </p>
          ) : (
            members.map((member, index) => (
              <MemberRow
                key={member.memberId}
                member={member}
                first={index === 0}
                busy={busy.has(member.memberId)}
                time={time}
                onPause={() => void setMember(member, member.status === 'paused' ? 'resume' : 'pause')}
                onRemove={() => void removeMember(member)}
              />
            ))
          )}
        </div>
      </section>

      {linkOpen && (
        <ProviderShareLinkDialog
          providerId={providerId}
          providerLabel={providerName}
          onClose={() => setLinkOpen(false)}
        />
      )}
    </div>
  );
}

function MemberRow({
  member,
  first,
  busy,
  time,
  onPause,
  onRemove,
}: {
  member: ProviderShareMemberView;
  first: boolean;
  busy: boolean;
  time: ReturnType<typeof useShareTimeFormat>;
  onPause: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const paused = member.status === 'paused';
  const statusText = paused
    ? t('providerShare.manage.members.statusPaused')
    : member.runningTasks > 0
      ? t('providerShare.manage.members.statusRunning', { count: member.runningTasks })
      : t('providerShare.manage.members.statusActive');
  // 用量在上方「用量」块里按人列出(供应商组 §10)，这里只管分享本身。
  return (
    <div
      data-testid="provider-share-member-row"
      className={cn('flex flex-wrap items-center gap-3 px-4 py-3', !first && 'border-t border-[var(--settings-theme-card-border)]')}
    >
      <ShareAvatar
        displayName={member.displayName}
        avatarUrl={member.avatarUrl}
        className={cn(paused && 'opacity-70')}
      />
      <div className={cn('flex min-w-[180px] flex-1 flex-col gap-0.5', paused && 'opacity-70')}>
        <div className="flex flex-wrap items-center gap-2 text-13">
          <span className="font-medium text-[var(--text-primary)]">{member.displayName}</span>
          <span className="inline-flex items-center gap-1.5 text-12 text-[var(--text-secondary)]">
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                paused ? 'bg-[var(--remote-status-disconnected)]' : 'bg-[var(--remote-status-ready)]',
              )}
            />
            {statusText}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-12 text-[var(--text-secondary)]">
          <span>{t('providerShare.manage.members.joined', { date: time.date(Date.parse(member.joinedAt)) })}</span>
          <span aria-hidden="true">·</span>
          <span>
            {member.lastUsedAt
              ? t('providerShare.manage.members.lastUsed', { time: time.relative(member.lastUsedAt) })
              : t('providerShare.manage.members.neverUsed')}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="secondary" size="sm" compact disabled={busy} onClick={onPause}>
          {t(paused ? 'providerShare.manage.members.resume' : 'providerShare.manage.members.pause')}
        </Button>
        <Button
          variant="secondary"
          tone="danger"
          size="sm"
          compact
          disabled={busy}
          aria-label={t('providerShare.manage.members.removeAria', { name: member.displayName })}
          onClick={onRemove}
        >
          {t('providerShare.manage.members.remove')}
        </Button>
      </div>
    </div>
  );
}
