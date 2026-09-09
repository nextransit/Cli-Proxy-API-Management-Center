import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';
import { useNotificationStore } from '@/stores';

const { useBlockerMock, useLocationMock } = vi.hoisted(() => ({
  useBlockerMock: vi.fn(),
  useLocationMock: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useBlocker: useBlockerMock,
    useLocation: useLocationMock,
  };
});

type MockRouterLocation = {
  pathname: string;
  search: string;
  hash: string;
  key: string;
};

type MockBlocker = {
  state: 'unblocked' | 'blocked' | 'proceeding';
  location?: {
    pathname: string;
    search: string;
    hash: string;
  };
  proceed: () => void;
  reset: () => void;
};

function GuardHarness() {
  useUnsavedChangesGuard({
    enabled: true,
    shouldBlock: true,
    dialog: {
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      confirmText: 'Leave',
      cancelText: 'Stay',
      variant: 'danger',
    },
  });

  return null;
}

describe('useUnsavedChangesGuard', () => {
  let location: MockRouterLocation;
  let blocker: MockBlocker;
  let proceedSpy: ReturnType<typeof vi.fn>;
  let resetSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    proceedSpy = vi.fn();
    resetSpy = vi.fn();
    location = {
      pathname: '/current',
      search: '',
      hash: '',
      key: 'location-1',
    };
    blocker = {
      state: 'unblocked',
      proceed: proceedSpy,
      reset: resetSpy,
    };

    useBlockerMock.mockImplementation(() => blocker);
    useLocationMock.mockImplementation(() => location);
    useNotificationStore.setState((state) => ({
      ...state,
      confirmation: {
        isOpen: false,
        isLoading: false,
        options: null,
      },
      notifications: [],
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the unsaved changes confirmation for a blocked navigation', () => {
    blocker = {
      ...blocker,
      state: 'blocked',
      location: {
        pathname: '/target',
        search: '',
        hash: '',
      },
    };

    render(<GuardHarness />);

    const confirmation = useNotificationStore.getState().confirmation;
    expect(confirmation.isOpen).toBe(true);
    expect(confirmation.options?.title).toBe('Unsaved changes');
  });

  it('suppresses an immediate duplicate block after cancelling the same navigation', () => {
    blocker = {
      ...blocker,
      state: 'blocked',
      location: {
        pathname: '/target',
        search: '',
        hash: '',
      },
    };

    const { rerender } = render(<GuardHarness />);

    const firstConfirmation = useNotificationStore.getState().confirmation.options;
    expect(firstConfirmation).not.toBeNull();

    act(() => {
      firstConfirmation?.onCancel?.();
      useNotificationStore.getState().hideConfirmation();
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);

    blocker = {
      ...blocker,
      state: 'unblocked',
      location: undefined,
    };
    rerender(<GuardHarness />);

    blocker = {
      ...blocker,
      state: 'blocked',
      location: {
        pathname: '/target',
        search: '',
        hash: '',
      },
    };
    rerender(<GuardHarness />);

    expect(resetSpy).toHaveBeenCalledTimes(2);
    expect(useNotificationStore.getState().confirmation.isOpen).toBe(false);
  });

  it('shows the confirmation again after the suppression window expires', () => {
    blocker = {
      ...blocker,
      state: 'blocked',
      location: {
        pathname: '/target',
        search: '',
        hash: '',
      },
    };

    const { rerender } = render(<GuardHarness />);
    const firstConfirmation = useNotificationStore.getState().confirmation.options;
    expect(firstConfirmation).not.toBeNull();

    act(() => {
      firstConfirmation?.onCancel?.();
      useNotificationStore.getState().hideConfirmation();
    });

    blocker = {
      ...blocker,
      state: 'unblocked',
      location: undefined,
    };
    rerender(<GuardHarness />);

    act(() => {
      vi.advanceTimersByTime(601);
    });

    blocker = {
      ...blocker,
      state: 'blocked',
      location: {
        pathname: '/target',
        search: '',
        hash: '',
      },
    };
    rerender(<GuardHarness />);

    const confirmation = useNotificationStore.getState().confirmation;
    expect(confirmation.isOpen).toBe(true);
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });
});
