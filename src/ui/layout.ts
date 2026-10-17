// Pure layout math, kept out of the DOM code so it can be unit-tested.

/** Number of thumbnails that should fit into the strip's height. */
export const VISIBLE_THUMBNAILS = 3;
/** Smallest slot height, so tiny windows still show recognisable thumbnails. */
export const MIN_THUMB_SLOT_HEIGHT = 60;

export interface StripMetrics {
  /** clientHeight of the scrolling strip (includes padding). */
  containerHeight: number;
  paddingTop: number;
  paddingBottom: number;
  /** Vertical gap between two thumbnail slots. */
  gap: number;
}

/**
 * Height of one thumbnail slot so that `visible` slots plus the gaps between
 * them fill the strip's content box exactly (rounded down to whole pixels).
 */
export function thumbnailSlotHeight(
  { containerHeight, paddingTop, paddingBottom, gap }: StripMetrics,
  visible = VISIBLE_THUMBNAILS,
): number {
  const available = containerHeight - paddingTop - paddingBottom - gap * (visible - 1);
  return Math.max(MIN_THUMB_SLOT_HEIGHT, Math.floor(available / visible));
}
