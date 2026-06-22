import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PropsWithChildren,
  type FocusEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconX } from './icons';

interface DrawerProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  width?: number | string;
  className?: string;
  closeDisabled?: boolean;
  modal?: boolean;
  onPanelMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onPanelMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onPanelFocus?: FocusEventHandler<HTMLDivElement>;
  onPanelBlur?: FocusEventHandler<HTMLDivElement>;
}

const DRAWER_ANIMATION_DURATION = 300;
const DRAWER_LOCK_CLASS = 'drawer-open';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let activeDrawerCount = 0;

interface ScrollSnapshot {
  scrollY: number;
  contentScrollTop: number;
  contentEl: HTMLElement | null;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverflow: string;
  htmlOverflow: string;
}

const scrollSnapshot: ScrollSnapshot = {
  scrollY: 0,
  contentScrollTop: 0,
  contentEl: null,
  bodyPosition: '',
  bodyTop: '',
  bodyLeft: '',
  bodyRight: '',
  bodyWidth: '',
  bodyOverflow: '',
  htmlOverflow: '',
};

const resolveContentScrollContainer = (): HTMLElement | null => {
  if (typeof document === 'undefined') return null;
  const contentEl = document.querySelector('.content');
  return contentEl instanceof HTMLElement ? contentEl : null;
};

const lockScroll = () => {
  if (typeof document === 'undefined') return;
  if (activeDrawerCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const contentEl = resolveContentScrollContainer();

    scrollSnapshot.scrollY = window.scrollY || window.pageYOffset || html.scrollTop || 0;
    scrollSnapshot.contentEl = contentEl;
    scrollSnapshot.contentScrollTop = contentEl?.scrollTop ?? 0;
    scrollSnapshot.bodyPosition = body.style.position;
    scrollSnapshot.bodyTop = body.style.top;
    scrollSnapshot.bodyLeft = body.style.left;
    scrollSnapshot.bodyRight = body.style.right;
    scrollSnapshot.bodyWidth = body.style.width;
    scrollSnapshot.bodyOverflow = body.style.overflow;
    scrollSnapshot.htmlOverflow = html.style.overflow;

    body.classList.add(DRAWER_LOCK_CLASS);
    html.classList.add(DRAWER_LOCK_CLASS);

    body.style.position = 'fixed';
    body.style.top = `-${scrollSnapshot.scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
  }
  activeDrawerCount += 1;
};

const unlockScroll = () => {
  if (typeof document === 'undefined') return;
  activeDrawerCount = Math.max(0, activeDrawerCount - 1);
  if (activeDrawerCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const previousScrollY = scrollSnapshot.scrollY;
    const previousContentScrollTop = scrollSnapshot.contentScrollTop;
    const contentEl = scrollSnapshot.contentEl;

    body.classList.remove(DRAWER_LOCK_CLASS);
    html.classList.remove(DRAWER_LOCK_CLASS);

    body.style.position = scrollSnapshot.bodyPosition;
    body.style.top = scrollSnapshot.bodyTop;
    body.style.left = scrollSnapshot.bodyLeft;
    body.style.right = scrollSnapshot.bodyRight;
    body.style.width = scrollSnapshot.bodyWidth;
    body.style.overflow = scrollSnapshot.bodyOverflow;
    html.style.overflow = scrollSnapshot.htmlOverflow;

    if (contentEl) {
      contentEl.scrollTo({ top: previousContentScrollTop, left: 0, behavior: 'auto' });
    }
    window.scrollTo({ top: previousScrollY, left: 0, behavior: 'auto' });

    scrollSnapshot.scrollY = 0;
    scrollSnapshot.contentScrollTop = 0;
    scrollSnapshot.contentEl = null;
  }
};

export function Drawer({
  open,
  title,
  onClose,
  width = 560,
  className,
  closeDisabled = false,
  modal = true,
  onPanelMouseEnter,
  onPanelMouseLeave,
  onPanelFocus,
  onPanelBlur,
  children,
}: PropsWithChildren<DrawerProps>) {
  const { t } = useTranslation();
  const titleId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!drawerRef.current) return [];
    return Array.from(
      drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }, []);

  const startClose = useCallback(
    (notifyParent: boolean) => {
      if (closeTimerRef.current !== null) return;
      setIsClosing(true);
      closeTimerRef.current = window.setTimeout(() => {
        setIsVisible(false);
        setIsClosing(false);
        closeTimerRef.current = null;
        if (notifyParent) {
          onClose();
        }
      }, DRAWER_ANIMATION_DURATION);
    },
    [onClose]
  );

  useEffect(() => {
    let cancelled = false;

    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      queueMicrotask(() => {
        if (cancelled) return;
        setIsVisible(true);
        setIsClosing(false);
      });
    } else if (isVisible) {
      queueMicrotask(() => {
        if (cancelled) return;
        startClose(false);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [open, isVisible, startClose]);

  const handleClose = useCallback(() => {
    startClose(true);
  }, [startClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const shouldLockScroll = modal && (open || isVisible);

  useEffect(() => {
    if (!shouldLockScroll) return;
    lockScroll();
    return () => unlockScroll();
  }, [shouldLockScroll]);

  useEffect(() => {
    if (!open || !modal) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = getFocusableElements()[0];
      (firstFocusable ?? closeButtonRef.current ?? drawerRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [getFocusableElements, open]);

  useEffect(() => {
    if (!modal || open || isVisible) return;
    previouslyFocusedRef.current?.focus();
    previouslyFocusedRef.current = null;
  }, [isVisible, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (closeDisabled) return;
        event.preventDefault();
        handleClose();
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeDisabled, handleClose, open]);

  if (!open && !isVisible) return null;

  const overlayClass = `drawer-overlay ${modal ? '' : 'drawer-overlay-preview'} ${isClosing ? 'drawer-overlay-closing' : 'drawer-overlay-entering'}`;
  const panelClass = `drawer-panel ${isClosing ? 'drawer-panel-closing' : 'drawer-panel-entering'}${className ? ` ${className}` : ''}`;

  const content = (
    <div className={overlayClass} onClick={modal && !closeDisabled ? handleClose : undefined}>
      <div
        ref={drawerRef}
        className={panelClass}
        style={{ width }}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onPanelMouseEnter}
        onMouseLeave={onPanelMouseLeave}
        onFocus={onPanelFocus}
        onBlur={onPanelBlur}
      >
        <div className="drawer-header">
          <div className="drawer-title" id={title ? titleId : undefined}>
            {title}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-close-btn"
            onClick={closeDisabled ? undefined : handleClose}
            aria-label={t('common.close')}
            disabled={closeDisabled}
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return content;
  }

  return createPortal(content, document.body);
}
