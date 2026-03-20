import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showUpgradePrompt } from '../src/lib/upgrade';

describe('upgrade', () => {
  describe('showUpgradePrompt', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('displays upgrade message with default URL', () => {
      showUpgradePrompt();
      const output = logSpy.mock.calls.join('');
      expect(output).toContain('Monthly run limit reached');
      expect(output).toContain('drill.dev/upgrade');
    });

    it('displays upgrade message with custom URL', () => {
      showUpgradePrompt('https://custom.upgrade/page');
      const output = logSpy.mock.calls.join('');
      expect(output).toContain('custom.upgrade/page');
    });

    it('shows the URL in underlined cyan format', () => {
      showUpgradePrompt('https://custom.upgrade/page');
      const output = logSpy.mock.calls.join('');
      expect(output).toContain('https://custom.upgrade/page');
    });
  });
});
