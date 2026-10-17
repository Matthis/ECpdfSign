import { degrees, PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocument, type PDFPageProxy } from "../pdf/pdfjs";
import type { PageViewport } from "../pdf/viewport";
import {
  boxCorners,
  boxFromGeometry,
  boxPoint,
  boxToGeometry,
  defaultPlacement,
  keepOnPage,
  MIN_SIZE,
  moveBox,
  pointerAngle,
  resizeBox,
  rotateBox,
  rotatedBounds,
  snapRotation,
  type Box,
  type Point,
} from "./geometry";

function expectPoint(actual: Point, expected: Point, digits = 6): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

const BOX: Box = { cx: 200, cy: 150, width: 100, height: 50, rotation: 0 };

describe("move", () => {
  it("shifts only the center", () => {
    expect(moveBox(BOX, 10, -5)).toEqual({ ...BOX, cx: 210, cy: 145 });
  });
});

describe("corner resize", () => {
  it("keeps the aspect ratio and the opposite corner (unrotated)", () => {
    const out = resizeBox(BOX, "se", 20, 10);
    expect(out.width / out.height).toBeCloseTo(2, 9);
    expect(out.width).toBeCloseTo(120);
    expectPoint(boxCorners(out)[0], boxCorners(BOX)[0]); // nw fixed
  });

  for (const rotation of [30, 90, 200, 315]) {
    it(`keeps the aspect ratio and the opposite corner at ${rotation}°`, () => {
      const start = { ...BOX, rotation };
      for (const [handle, opposite] of [["nw", 2], ["ne", 3], ["se", 0], ["sw", 1]] as const) {
        const out = resizeBox(start, handle, 37, -11);
        expect(out.width / out.height).toBeCloseTo(2, 9);
        expect(out.rotation).toBe(rotation);
        expectPoint(boxCorners(out)[opposite], boxCorners(start)[opposite]);
      }
    });
  }

  it("follows the pointer along the diagonal when rotated", () => {
    const start = { ...BOX, rotation: 30 };
    // Drag the se corner exactly outwards along the element's own diagonal.
    const se = boxPoint(start, 50, 25);
    const target = boxPoint(start, 100, 50);
    const out = resizeBox(start, "se", target.x - se.x, target.y - se.y);
    expect(out.width).toBeCloseTo(150);
    expect(out.height).toBeCloseTo(75);
    expectPoint(boxCorners(out)[2], target);
  });

  it("stops at the minimum size on the short side", () => {
    const out = resizeBox(BOX, "se", -500, -500);
    expect(out.height).toBeCloseTo(MIN_SIZE);
    expect(out.width).toBeCloseTo(2 * MIN_SIZE);
    expectPoint(boxCorners(out)[0], boxCorners(BOX)[0]);
  });

  it("never grows a box that is already below the minimum when shrinking", () => {
    const tiny = { ...BOX, width: 20, height: 10 };
    const out = resizeBox(tiny, "se", -50, -50);
    expect(out.width).toBeCloseTo(20);
    expect(out.height).toBeCloseTo(10);
  });
});

describe("edge resize", () => {
  for (const rotation of [0, 30, 90, 250]) {
    it(`changes one dimension along the element's axis at ${rotation}°`, () => {
      const start = { ...BOX, rotation };
      // e: the w edge (corners nw=0 and sw=3) stays put.
      const along = boxPoint({ ...start, cx: 0, cy: 0 }, 30, 0); // 30 px along local x
      const across = boxPoint({ ...start, cx: 0, cy: 0 }, 0, 40); // ignored component
      const e = resizeBox(start, "e", along.x + across.x, along.y + across.y);
      expect(e.width).toBeCloseTo(130);
      expect(e.height).toBeCloseTo(50);
      expectPoint(boxCorners(e)[0], boxCorners(start)[0]);
      expectPoint(boxCorners(e)[3], boxCorners(start)[3]);

      // n: the s edge (corners se=2 and sw=3) stays put; dragging up enlarges.
      const up = boxPoint({ ...start, cx: 0, cy: 0 }, 0, -20);
      const n = resizeBox(start, "n", up.x, up.y);
      expect(n.width).toBeCloseTo(100);
      expect(n.height).toBeCloseTo(70);
      expectPoint(boxCorners(n)[2], boxCorners(start)[2]);
      expectPoint(boxCorners(n)[3], boxCorners(start)[3]);
    });
  }

  it("stops at the minimum size", () => {
    expect(resizeBox(BOX, "w", 500, 0).width).toBeCloseTo(MIN_SIZE);
    expect(resizeBox(BOX, "s", 0, -500).height).toBeCloseTo(MIN_SIZE);
  });
});

describe("keep on page", () => {
  const page = { width: 600, height: 800 };

  it("leaves boxes alone that are on the page or only partly hang over", () => {
    expect(keepOnPage(BOX, page)).toEqual(BOX);
    const over = { ...BOX, cx: -20 }; // right edge at 30 px
    expect(keepOnPage(over, page)).toEqual(over);
  });

  it("keeps 16 px of the rotated bounding box on the page on every side", () => {
    for (const rotation of [0, 30, 90, 135]) {
      const start = { ...BOX, rotation };
      const left = rotatedBounds(keepOnPage(moveBox(start, -5000, -5000), page));
      expect(left.right).toBeCloseTo(16);
      expect(left.bottom).toBeCloseTo(16);
      const right = rotatedBounds(keepOnPage(moveBox(start, 5000, 5000), page));
      expect(right.left).toBeCloseTo(page.width - 16);
      expect(right.top).toBeCloseTo(page.height - 16);
    }
  });
});

describe("rotation", () => {
  it("measures the pointer angle clockwise on screen", () => {
    expect(pointerAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
  });

  it("rotates about the center by the swept angle", () => {
    const above = { x: BOX.cx, y: BOX.cy - 60 };
    const right = { x: BOX.cx + 60, y: BOX.cy };
    const out = rotateBox(BOX, above, right, false);
    expect(out.rotation).toBeCloseTo(90);
    expect(out.cx).toBe(BOX.cx);
    expect(out.cy).toBe(BOX.cy);
    expect(out.width).toBe(BOX.width);
    // Sweeping 45° counter-clockwise from 0° gives 315°.
    const ccw = { x: BOX.cx - 60, y: BOX.cy - 60 };
    expect(rotateBox(BOX, above, ccw, false).rotation).toBeCloseTo(315);
  });

  it("does not jump when the handle is grabbed off-center", () => {
    const start = { ...BOX, rotation: 40 };
    const grab = { x: BOX.cx + 7, y: BOX.cy - 61 };
    expect(rotateBox(start, grab, grab, false).rotation).toBeCloseTo(40);
  });

  it("snaps to 0/90/180/270 within ±3°", () => {
    expect(snapRotation(88, false)).toBe(90);
    expect(snapRotation(93, false)).toBe(90);
    expect(snapRotation(86.9, false)).toBeCloseTo(86.9);
    expect(snapRotation(178, false)).toBe(180);
    expect(snapRotation(272.5, false)).toBe(270);
    expect(snapRotation(358, false)).toBe(0);
    expect(snapRotation(2, false)).toBe(0);
    expect(snapRotation(-2, false)).toBe(0);
    expect(snapRotation(12, false)).toBeCloseTo(12);
  });

  it("uses 15° steps with Shift", () => {
    expect(snapRotation(22, true)).toBe(15);
    expect(snapRotation(23, true)).toBe(30);
    expect(snapRotation(-8, true)).toBe(345);
    expect(snapRotation(353, true)).toBe(0);
  });

  it("normalizes to [0, 360)", () => {
    expect(snapRotation(370, false)).toBe(10);
    expect(snapRotation(-30, false)).toBe(330);
  });
});

describe("default placement", () => {
  it("centers the image at 25% of the page width with its aspect ratio, upright", () => {
    expect(defaultPlacement({ width: 600, height: 800 }, 400, 100)).toEqual({
      cx: 300,
      cy: 400,
      width: 150,
      height: 37.5,
      rotation: 0,
    });
  });

  it("enlarges very flat images to the minimum short side", () => {
    const box = defaultPlacement({ width: 400, height: 500 }, 2000, 20);
    expect(box.height).toBeCloseTo(MIN_SIZE);
    expect(box.width / box.height).toBeCloseTo(100);
  });
});

// Real pdf.js viewports: page 1 plain, page 2 /Rotate 90 with a CropBox offset,
// page 3 /Rotate 270 with the same CropBox.
describe("PDF round trip", () => {
  let destroy: (() => Promise<void>) | undefined;
  const pages: PDFPageProxy[] = [];

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    for (const rotation of [90, 270]) {
      const page = doc.addPage([600, 800]);
      page.setCropBox(50, 100, 400, 500);
      page.setRotation(degrees(rotation));
    }
    const task = getDocument({ data: await doc.save() });
    destroy = () => task.destroy();
    const proxy = await task.promise;
    for (let i = 1; i <= proxy.numPages; i++) pages.push(await proxy.getPage(i));
  });

  afterAll(async () => {
    await destroy?.();
  });

  const vp = (index: number, scale: number): PageViewport => pages[index].getViewport({ scale });

  function expectBox(actual: Box, expected: Box): void {
    // 0.01 px / 0.01°
    for (const key of ["cx", "cy", "width", "height", "rotation"] as const) {
      expect(Math.abs(actual[key] - expected[key])).toBeLessThan(0.01);
    }
  }

  for (const [name, index] of [["plain", 0], ["/Rotate 90 + CropBox", 1], ["/Rotate 270 + CropBox", 2]] as const) {
    it(`a 30° signature on a ${name} page converts back to its screen box after move and resize`, () => {
      const viewport = vp(index, 1.3);
      const page = { width: viewport.width, height: viewport.height };
      let box: Box = { ...defaultPlacement(page, 300, 100), rotation: 30 };
      box = keepOnPage(moveBox(box, -73.4, 41.2), page);
      box = keepOnPage(resizeBox(box, "se", 25, 9), page);
      box = keepOnPage(resizeBox(box, "n", 3, -17), page);

      const stored = boxToGeometry(viewport, box);
      expect(stored.rotation).toBeCloseTo(30, 9);
      expectBox(boxFromGeometry(viewport, stored), box);
    });

    it(`keeps page-relative geometry on a ${name} page when the viewport scale changes`, () => {
      const small = vp(index, 0.8);
      const large = vp(index, 2);
      const box: Box = { cx: 120, cy: 90, width: 80, height: 30, rotation: 30 };
      const stored = boxToGeometry(small, box);
      const scaled = boxFromGeometry(large, stored);
      expectBox(scaled, {
        cx: box.cx * 2.5,
        cy: box.cy * 2.5,
        width: box.width * 2.5,
        height: box.height * 2.5,
        rotation: 30,
      });
    });
  }

  it("stores the upright screen box with width along PDF y on a 90° page", () => {
    const viewport = vp(1, 1);
    const stored = boxToGeometry(viewport, { cx: 100, cy: 50, width: 120, height: 40, rotation: 0 });
    expect(stored.rect.width).toBeCloseTo(40);
    expect(stored.rect.height).toBeCloseTo(120);
  });
});
