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
  /**
   * When true (the default), the link is only active when the current path is
   * exactly `to`. When false, it stays active for nested routes whose path
   * starts with `to + '/'`. This mirrors the semantics of react-router's
   * <NavLink end={...}> prop, but flipped: the legacy NavLink defaulted to
   * false, which is what causes the "Dashboard stays active forever" bug
   * when `to="/"` because the root path prefixes everything.
   */
  end?: boolean;
  caseSensitive?: boolean;
}

/**
 * Drop-in replacement for NavLink that wraps the navigation in a React
 * transition. The click handler returns synchronously and the new route tree
 * is committed at the next paint boundary instead of blocking the click
 * response. We keep the active/pending className API compatible so callers
 * do not have to change anything else.
 *
 * A caller-supplied onClick (e.g. closing the mobile sidebar) is composed
 * with the internal navigation handler instead of overwriting it. The link
 * still navigates after the caller's onClick runs.
 */
export function TransitionNavLink({
  to,
  className,
  children,
  end = true,
  caseSensitive,
  onClick: externalOnClick,
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
      if (to === location.pathname && !location.search && !location.hash) {
        // Already on the same path; do nothing.
        return;
      }
      // Run any caller-supplied onClick (e.g. closing the mobile sidebar)
      // before we own the anchor's default action. We must defer the
      // preventDefault() until after this step because the caller's
      // onClick should be free to observe the unaltered event, and once
      // preventDefault() runs the event's defaultPrevented flag stays
      // true for the remainder of the dispatch.
      if (externalOnClick) {
        externalOnClick(event);
        if (event.defaultPrevented) {
          // The caller already took over the default action - bail out.
          return;
        }
      }
      event.preventDefault();
      // react-router v7 schedules the new route tree through startTransition
      // so the click handler returns immediately. Flushing synchronously would
      // re-trigger the max-update-depth guard, so we let React commit the new
      // location at the next paint boundary.
      startTransition(() => {
        navigate(to);
      });
    },
    [
      navigate,
      to,
      location.pathname,
      location.search,
      location.hash,
      externalOnClick,
    ]
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

/**
 * Decide whether `to` is the active match for the current location. The rules
 * match react-router's <NavLink> semantics:
 *
 * - `end === true` (default): only exact path equality counts. The root path
 *   '/' is special-cased so it never claims a nested route.
 * - `end === false`: the current path must start with `to` followed by either
 *   nothing or a path segment boundary ('/').
 *
 * Query string and hash are ignored because the sidebar links do not carry
 * them; nested-route matching still works because we compare on pathname
 * segments, not raw prefixes.
 */
function checkIsActive(
  location: Location,
  to: string,
  end: boolean,
  caseSensitive?: boolean
): boolean {
  const targetPath = to.split('?')[0].split('#')[0];
  const currentPath = location.pathname;
  const cmp = caseSensitive
    ? (a: string, b: string) => a === b
    : (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  if (end) {
    // The root path '/' would otherwise match every pathname that begins with
    // '/'. Treat it as exact-only and never as a prefix.
    if (targetPath === '/' || targetPath === '') {
      return currentPath === '/' || currentPath === '';
    }
    return cmp(currentPath, targetPath);
  }

  if (targetPath === '/' || targetPath === '') {
    // Prefix-matching against '/' is meaningless for our routes; fall back
    // to exact match to keep the sidebar from glowing on every page.
    return currentPath === '/' || currentPath === '';
  }
  if (currentPath === targetPath) return true;
  if (!currentPath.startsWith(targetPath)) return false;
  // Require a segment boundary so '/config' does not match '/configuration'.
  const nextChar = currentPath.charAt(targetPath.length);
  if (nextChar === '' || nextChar === '/') return true;
  return false;
}
