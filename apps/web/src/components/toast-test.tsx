import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { Toast } from './toast.tsx';
import { TOAST_MS, useToastTimeout } from './use-toast-timeout.ts';

describe('Toast', () => {
  it('is an alert with what it says', () => {
    render(
      <Toast testId="toast" onDismiss={vi.fn()}>
        Something happened
      </Toast>,
    );

    expect(screen.getByRole('alert')).toBe(screen.getByTestId('toast'));
    expect(screen.getByTestId('toast')).toHaveTextContent('Something happened');
  });

  it('is dropped by a click', () => {
    const onDismiss = vi.fn();
    render(
      <Toast testId="toast" onDismiss={onDismiss}>
        Hi
      </Toast>,
    );

    fireEvent.click(screen.getByTestId('toast'));

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('useToastTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drops a toast once it has been up for a while, not before', () => {
    const dismiss = vi.fn();
    renderHook(() => useToastTimeout('problem', dismiss));

    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('keeps counting when the view renders again with a new function', () => {
    const dismiss = vi.fn();
    const { rerender } = renderHook(() => useToastTimeout('problem', () => dismiss()));

    vi.advanceTimersByTime(TOAST_MS - 1);
    rerender();
    vi.advanceTimersByTime(1);

    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('does nothing without a toast', () => {
    const dismiss = vi.fn();
    renderHook(() => useToastTimeout(undefined, dismiss));

    vi.advanceTimersByTime(TOAST_MS * 2);

    expect(dismiss).not.toHaveBeenCalled();
  });
});
