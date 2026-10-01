import { applyTheme } from './theme.ts';

describe('applyTheme', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const)('forces the %s theme with an attribute', (theme, expected) => {
    applyTheme(theme);

    expect(document.documentElement).toHaveAttribute('data-theme', expected);
  });

  it('removes the attribute for the system theme', () => {
    applyTheme('dark');

    applyTheme('system');

    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
