import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BlockerFunction } from 'react-router';
import { useBlocker, useLocation } from 'react-router';
import { useNotificationStore } from '@/stores';

type ConfirmationVariant = 'danger' | 'primary' | 'secondary';

export type UnsavedChangesDialog = {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant?: ConfirmationVariant;
};

export type UseUnsavedChangesGuardOptions = {
  enabled?: boolean;
  shouldBlock: boolean | BlockerFunction;
  dialog: UnsavedChangesDialog;
};

const CANCELLED_NAVIGATION_SUPPRESSION_MS = 600;

const buildNavigationKey = (location?: {
  pathname?: string;
  search?: string;
  hash?: string;
}) => {
  if (!location) return '';
  return `${location.pathname ?? ''}${location.search ?? ''}${location.hash ?? ''}`;
};

export function useUnsavedChangesGuard(options: UseUnsavedChangesGuardOptions) {
  const { enabled = true, shouldBlock, dialog } = options;
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const lastBlockedRef = useRef<string>('');
  const cancelledBlockedRef = useRef<{ key: string; expiresAt: number } | null>(null);
  const allowNextNavigationUntilRef = useRef(0);
  const allowNextNavigationKeyRef = useRef('');
  const location = useLocation();

  const allowNextNavigation = useCallback(() => {
    // Allow one programmatic navigation after successful save.
    // A short window is used to avoid stale flags lingering when no navigation happens.
    allowNextNavigationUntilRef.current = Date.now() + 2_000;
    allowNextNavigationKeyRef.current = '';
  }, []);

  const shouldBlockFunction = useCallback<BlockerFunction>(
    (args) => {
      if (!enabled) return false;
      const now = Date.now();

      if (allowNextNavigationUntilRef.current > now) {
        const nextKey = `${args.nextLocation.pathname}${args.nextLocation.search}${args.nextLocation.hash}`;
        if (!allowNextNavigationKeyRef.current) {
          allowNextNavigationKeyRef.current = nextKey;
        }
        if (allowNextNavigationKeyRef.current === nextKey) {
          return false;
        }
      } else if (allowNextNavigationUntilRef.current !== 0) {
        allowNextNavigationUntilRef.current = 0;
        allowNextNavigationKeyRef.current = '';
      }

      return typeof shouldBlock === 'function' ? shouldBlock(args) : shouldBlock;
    },
    [enabled, shouldBlock]
  );

  const blocker = useBlocker(shouldBlockFunction);

  useEffect(() => {
    if (allowNextNavigationUntilRef.current === 0) return;
    allowNextNavigationUntilRef.current = 0;
    allowNextNavigationKeyRef.current = '';
  }, [location.key]);

  const blockedKey = useMemo(() => {
    if (blocker.state !== 'blocked' || !blocker.location) return '';
    return buildNavigationKey(blocker.location);
  }, [blocker.location, blocker.state]);

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      lastBlockedRef.current = '';
      return;
    }

    if (cancelledBlockedRef.current && cancelledBlockedRef.current.expiresAt <= Date.now()) {
      cancelledBlockedRef.current = null;
    }

    if (cancelledBlockedRef.current?.key === blockedKey) {
      blocker.reset();
      return;
    }

    if (!blockedKey || lastBlockedRef.current === blockedKey) {
      return;
    }
    lastBlockedRef.current = blockedKey;

    showConfirmation({
      title: dialog.title,
      message: dialog.message,
      confirmText: dialog.confirmText,
      cancelText: dialog.cancelText,
      variant: dialog.variant ?? 'danger',
      onConfirm: () => {
        cancelledBlockedRef.current = null;
        blocker.proceed();
      },
      onCancel: () => {
        cancelledBlockedRef.current = {
          key: blockedKey,
          expiresAt: Date.now() + CANCELLED_NAVIGATION_SUPPRESSION_MS,
        };
        blocker.reset();
      },
    });
  }, [blockedKey, blocker, dialog, showConfirmation]);

  useEffect(() => {
    cancelledBlockedRef.current = null;
  }, [location.key]);

  return { allowNextNavigation };
}
