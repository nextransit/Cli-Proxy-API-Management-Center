/**
 * Best-effort copy of a text payload to the system clipboard.
 *
 * Returns true when the copy succeeded, false when neither the modern
 * Clipboard API nor the legacy execCommand fallback could write the
 * payload (e.g. insecure context, missing permissions). Callers should
 * treat a false result as a soft failure rather than throwing.
 */
export const copyToClipboard = copyTextToClipboard;

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }
  document.body.removeChild(textarea);
  return success;
}
