/**
 * Inbox transcript scroll: preserve the agent's place on poll/re-render.
 * Stick to the bottom only when they were already near it (or they just opened / sent).
 * Otherwise keep the previous offset and show a "new messages" pill if the thread grew.
 */
export const NEAR_BOTTOM_PX = 120;

export function wasNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number, px = NEAR_BOTTOM_PX): boolean {
  return scrollHeight - scrollTop - clientHeight < px;
}

export function nextScrollTop(opts: {
  stick: boolean;
  prevTop: number | null;
  newScrollHeight: number;
  clientHeight: number;
}): number {
  if (opts.stick || opts.prevTop == null) return Math.max(0, opts.newScrollHeight - opts.clientHeight);
  return Math.max(0, Math.min(opts.prevTop, Math.max(0, opts.newScrollHeight - opts.clientHeight)));
}

export function shouldStick(opts: { force?: boolean; prevNearBottom?: boolean | null; hasPrev?: boolean }): boolean {
  if (opts.force) return true;
  if (!opts.hasPrev) return true;
  return Boolean(opts.prevNearBottom);
}

export function shouldShowNewPill(opts: { stick: boolean; grew: boolean }): boolean {
  return Boolean(opts.grew && !opts.stick);
}
