import { startTransition, useCallback, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

type NavLinkClassName =
  | string
  | ((args: { isActive: boolean; isPending: boolean }) => string)
  | undefined;

interface TransitionNavLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'> {
  to: string;
  className?: NavLinkClassName;
  children: ReactNode;
  end?: boolean;
  caseSensitive?: boolean;
}

/**
 * Drop-in replacement for NavLink that wraps the navigation in a React
 * transition. The click handler returns synchronously and the new route tree
 * is committed at the next paint boundary instead of blocking the click
 * response. We keep the active/pending className API compatible so callers
 * do not have to change anything else.
 */
export function TransitionNavLink({
  to,
  className,
  children,
  end,
  caseSensitive,
  ...rest
}: TransitionNavLinkProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = checkIsActive(location, to, end, caseSensitive);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Allow modified clicks (cmd/ctrl/middle) to behave like a normal link.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (to === location.pathname + location.search + location.hash) return;
      event.preventDefault();
      // react-router v7 schedules the new route tree through startTransition
      // so the click handler returns immediately. Flushing synchronously would
      // re-trigger the max-update-depth guard, so we let React commit the new
      // location at the next paint boundary.
      startTransition(() => {
        navigate(to);
      });
    },
    [navigate, to, location.pathname, location.search, location.hash]
  );

  const resolvedClassName =
    typeof className === 'function'
      ? className({ isActive, isPending: false })
      : className;

  return (
    <a
      href={`#${to}`}
      onClick={handleClick}
      className={resolvedClassName}
      {...rest}
    >
      {children}
    </a>
  );
}

function checkIsActive(
  location: Location,
  to: string,
  end?: boolean,
  caseSensitive?: boolean
): boolean {
  const targetPath = to.split('?')[0].split('#')[0];
  const currentPath = location.pathname;
  if (caseSensitive) {
    return end ? currentPath === targetPath : currentPath.startsWith(targetPath);
  }
  const lowerTarget = targetPath.toLowerCase();
  const lowerCurrent = currentPath.toLowerCase();
  return end ? lowerCurrent === lowerTarget : lowerCurrent.startsWith(lowerTarget);
}
