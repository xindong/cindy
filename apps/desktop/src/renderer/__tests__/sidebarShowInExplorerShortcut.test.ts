import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getEffectiveAppShortcuts } from '../../shared/appShortcuts';

const rendererRoot = resolve(__dirname, '..');
const read = (...parts: string[]) =>
  readFileSync(resolve(rendererRoot, ...parts), 'utf8').replace(/\r\n/g, '\n');

const projectNodeSource = read('features', 'cc-agent', 'sidebar', 'sections', 'ProjectNode.tsx');
const sessionItemSource = read('features', 'cc-agent', 'sidebar', 'SessionItem.tsx');
const sessionCardSource = read('features', 'cc-agent', 'sidebar', 'SessionCard.tsx');
const sessionHeaderSource = read('features', 'cc-agent', 'SessionContentHeader.tsx');
const menuItemSource = read('features', 'cc-agent', 'sidebar', 'ShowInExplorerMenuItem.tsx');

describe('sidebar show-in-explorer shortcut contract', () => {
  it('uses Ctrl+Shift+S on Windows/Linux and Command+Shift+S on macOS', () => {
    expect(getEffectiveAppShortcuts({}, 'win32').get('show-in-explorer')).toEqual([
      { code: 'KeyS', meta: false, ctrl: true, alt: false, shift: true },
    ]);
    expect(getEffectiveAppShortcuts({}, 'linux').get('show-in-explorer')).toEqual([
      { code: 'KeyS', meta: false, ctrl: true, alt: false, shift: true },
    ]);
    expect(getEffectiveAppShortcuts({}, 'darwin').get('show-in-explorer')).toEqual([
      { code: 'KeyS', meta: true, ctrl: false, alt: false, shift: true },
    ]);
  });

  it('exposes the action only for local project paths', () => {
    expect(projectNodeSource).toContain(
      'const canShowInExplorer = !isRemote && !isDeviceLink && Boolean(project.workingDir)',
    );
    expect(sessionItemSource).toContain(
      "session.workspaceKind === 'project' &&\n    Boolean(session.workingDir) &&\n    !session.remoteHostId &&\n    !session.deviceLinkDeviceId",
    );
    expect(sessionCardSource).toContain(
      "session.workspaceKind === 'project' &&\n    Boolean(session.workingDir) &&\n    !session.remoteHostId &&\n    !session.deviceLinkDeviceId",
    );
    expect(sessionHeaderSource).toContain(
      "session.workspaceKind === 'project' &&\n    Boolean(session.workingDir) &&\n    !session.remoteHostId &&\n    !session.deviceLinkDeviceId",
    );
  });

  it('binds the shortcut only while the shared menu item is mounted', () => {
    expect(menuItemSource).toMatch(/useAppShortcut\(\s*'show-in-explorer'/);
    expect(menuItemSource).toContain("useAppShortcutDisplay('show-in-explorer')");
    for (const source of [
      projectNodeSource,
      sessionItemSource,
      sessionCardSource,
      sessionHeaderSource,
    ]) {
      expect(source).toContain('ShowInExplorerMenuItem');
      expect(source).not.toContain("useAppShortcutDisplay('show-in-explorer')");
    }
  });

  it('renders the shortcut hint beside the existing explorer action', () => {
    expect(projectNodeSource).toContain('ccAgent.sidebar.projectAction.openInExplorer');
    expect(sessionItemSource).toContain('ccAgent.sidebar.sessionMenu.openInExplorer');
    expect(sessionCardSource).toContain('ccAgent.sidebar.sessionMenu.openInExplorer');
    expect(sessionHeaderSource).toContain('ccAgent.sidebar.sessionMenu.openInExplorer');
    expect(menuItemSource).toContain('shortcut &&');
    expect(menuItemSource).toContain('text-[var(--cmd-palette-item-meta)]');
  });
});
