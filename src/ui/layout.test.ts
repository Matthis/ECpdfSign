import { describe, expect, it } from "vitest";
import { MIN_THUMB_SLOT_HEIGHT, thumbnailSlotHeight, VISIBLE_THUMBNAILS } from "./layout";

const STRIP = { paddingTop: 12, paddingBottom: 12, gap: 12 };

describe("matrix: Window resize (thumbnail strip)", () => {
  it("sizes slots so that three thumbnails fill the strip", () => {
    expect(VISIBLE_THUMBNAILS).toBe(3);
    const slot = thumbnailSlotHeight({ ...STRIP, containerHeight: 809 });
    expect(slot).toBe(253);
    // Three slots, two gaps and the padding fit into the strip ...
    expect(3 * slot + 2 * STRIP.gap + 24).toBeLessThanOrEqual(809);
    // ... and leave less than one pixel per slot unused.
    expect(809 - (3 * slot + 2 * STRIP.gap + 24)).toBeLessThan(3);
  });

  it("keeps about three thumbnails visible after the window is resized", () => {
    for (const containerHeight of [540, 589, 770, 1000, 1400]) {
      const slot = thumbnailSlotHeight({ ...STRIP, containerHeight });
      const visible = (containerHeight - 24 + STRIP.gap) / (slot + STRIP.gap);
      expect(visible).toBeGreaterThanOrEqual(3);
      expect(visible).toBeLessThan(3.05);
    }
  });

  it("grows and shrinks with the strip", () => {
    const small = thumbnailSlotHeight({ ...STRIP, containerHeight: 600 });
    const large = thumbnailSlotHeight({ ...STRIP, containerHeight: 1200 });
    expect(large).toBeGreaterThan(small);
  });

  it("never goes below the minimum slot height", () => {
    expect(thumbnailSlotHeight({ ...STRIP, containerHeight: 0 })).toBe(MIN_THUMB_SLOT_HEIGHT);
    expect(thumbnailSlotHeight({ ...STRIP, containerHeight: 150 })).toBe(MIN_THUMB_SLOT_HEIGHT);
  });

  it("supports another visible count", () => {
    expect(thumbnailSlotHeight({ containerHeight: 100, paddingTop: 0, paddingBottom: 0, gap: 0 }, 1)).toBe(100);
  });
});
