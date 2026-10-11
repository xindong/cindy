/**
 * 本机任务按供应商记「本机」用量(provider-groups.md §7；账本见 usage/providerPartyUsageStore)：
 *  - 任务归本机建的供应商组：记在组那个供应商上，Agent 在组里哪台电脑运行都算；
 *  - 否则只在 Agent 就在本机运行时，记在任务用的供应商上。Agent 在别的电脑运行(远程 Agent、别的电脑上
 *    的组)或 SSH 远程工作区的任务不记，那一份由运行它的电脑记在「我的其他电脑」下。
 * 每个任务实例一个计量器(Claude 的累计值跟着 SDK 进程走)，与受邀者用量同一套算法。
 */
import type { AgentEvent, Session } from '@cindy/maker-core';

import type { ProviderGroupBinding } from '../provider-group/bindings.js';
import { createGuestUsageMeter, type GuestUsageSample } from '../remote-agent/host/guestUsage.js';

export interface SessionProviderPartyUsageDeps {
  /** 任务现在用的供应商；跟随默认路由时为 null。 */
  providerOf(sessionId: string): string | null;
  bindingOf(sessionId: string): ProviderGroupBinding | null;
  record(usage: { kind: string; providerId: string; samples: GuestUsageSample[] }): void;
}

/** 这一轮记在本机的哪个供应商上；不记返回 null。 */
export function localUsageProviderOf(input: {
  binding: ProviderGroupBinding | null;
  agentDeviceId: string | null;
  remoteHostId: string | null;
  providerId: string | null;
}): string | null {
  if (input.remoteHostId) return null;
  if (input.binding && !input.binding.groupDeviceId) return input.binding.providerId;
  return input.agentDeviceId ? null : input.providerId;
}

const meters = new WeakMap<Session, ReturnType<typeof createGuestUsageMeter>>();

export function recordSessionProviderPartyUsage(
  deps: SessionProviderPartyUsageDeps,
  session: Session,
  event: AgentEvent,
): void {
  if (event.type !== 'done') return;
  let meter = meters.get(session);
  if (!meter) {
    meter = createGuestUsageMeter(session.agentKind);
    meters.set(session, meter);
  }
  // 每一轮都喂给计量器，不记的轮次也要更新 Claude 的累计基线。
  const samples = meter.observe(event, session.model);
  if (samples.length === 0) return;
  const providerId = localUsageProviderOf({
    binding: deps.bindingOf(session.id),
    agentDeviceId: session.agentDeviceId,
    remoteHostId: session.remoteHostId,
    providerId: deps.providerOf(session.id),
  });
  if (providerId) deps.record({ kind: session.agentKind, providerId, samples });
}
