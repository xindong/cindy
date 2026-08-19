/**
 * FileBodyView shortcut ownership regression tests.
 *
 * Right-sidebar tabs stay mounted while hidden. Only the active, visible file
 * browser may register file shortcuts or claim global find-in-page ownership.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const fileBodySource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'workdir-browse', 'FileBodyView.tsx'),
  'utf8',
);
const fileBrowserBodySource = readFileSync(
  resolve(
    __dirname,
    '..',
    'features',
    'right-sidebar',
    'plugins',
    'file-browser',
    'FileBrowserBody.tsx',
  ),
  'utf8',
);

describe('right-sidebar file shortcut ownership', () => {
  it('enables file shortcuts only for the active visible tab', () => {
    expect(fileBrowserBodySource).toContain('shortcutsEnabled={active && shellVisible}');
    expect(fileBodySource).toContain('if (!shortcutsEnabled) return;');
    expect(fileBodySource.match(/enabled: shortcutsEnabled/g)).toHaveLength(3);
  });
});
