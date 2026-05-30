import type { KeyboardEvent, MouseEvent, PropsWithChildren, ReactNode } from 'react';
import { useState } from 'react';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
  className?: string;
  onHeaderClick?: () => void;
  headerExpanded?: boolean;
  headerAriaLabel?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Micro summary shown on the right while collapsed. */
  summary?: ReactNode;
}

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="switch"], [data-card-header-ignore-click]';

function shouldIgnoreHeaderToggle(target: EventTarget | null, currentTarget: Element) {
  if (!(target instanceof Element)) {
    return false;
  }
  const interactiveElement = target.closest(INTERACTIVE_SELECTOR);
  return Boolean(interactiveElement && interactiveElement !== currentTarget);
}

export function Card({
  title,
  extra,
  children,
  className,
  onHeaderClick,
  headerExpanded: headerExpandedProp,
  headerAriaLabel,
  collapsible = false,
  defaultCollapsed = false,
  summary,
}: PropsWithChildren<CardProps>) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  const isControlled = headerExpandedProp !== undefined;
  const isCollapsed = isControlled ? !headerExpandedProp : internalCollapsed;

  const clickable = typeof onHeaderClick === 'function' || collapsible;

  const handleHeaderClick = (event?: MouseEvent<HTMLDivElement>) => {
    if (event && shouldIgnoreHeaderToggle(event.target, event.currentTarget)) {
      return;
    }
    if (typeof onHeaderClick === 'function') {
      onHeaderClick();
    }
    if (collapsible && !isControlled) {
      setInternalCollapsed(!isCollapsed);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    if (shouldIgnoreHeaderToggle(event.target, event.currentTarget)) {
      return;
    }
    event.preventDefault();
    handleHeaderClick();
  };

  return (
    <div className={className ? `card ${className}` : 'card'}>
      {(title || extra) && (
        <div
          className={`card-header ${clickable ? 'card-header-clickable' : ''}`}
          onClick={handleHeaderClick}
          onKeyDown={handleKeyDown}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          aria-expanded={clickable ? !isCollapsed : undefined}
          aria-label={headerAriaLabel}
        >
          <div className="card-header-left">
            {collapsible && (
              <span className={`card-collapse-icon ${isCollapsed ? 'collapsed' : ''}`}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M4 6L8 10L12 6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
            <span className="card-title">{title}</span>
          </div>

          <div className="card-header-right">
            {/* Show the micro summary while collapsed. */}
            {collapsible && isCollapsed && summary && (
              <span className="card-summary">{summary}</span>
            )}
            {/* Show extra actions while expanded. */}
            {!collapsible && extra}
            {collapsible && !isCollapsed && extra}
          </div>
        </div>
      )}
      {collapsible ? (
        <div className={`card-content ${isCollapsed ? 'collapsed' : ''}`}>
          {!isCollapsed && children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
