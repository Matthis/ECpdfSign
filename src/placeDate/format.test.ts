import { describe, expect, it } from "vitest";
import {
  ddMmYyyyToIso,
  formatPlaceDate,
  isEmptyPlaceDate,
  isoToDdMmYyyy,
  todayDdMmYyyy,
} from "./format";

describe("formatPlaceDate", () => {
  it("joins both parts with a comma", () => {
    expect(formatPlaceDate("München", "17.10.2026")).toBe("München, 17.10.2026");
  });

  it("shows only the part that is given, without a comma", () => {
    expect(formatPlaceDate("", "17.10.2026")).toBe("17.10.2026");
    expect(formatPlaceDate("München", "")).toBe("München");
  });

  it("ignores surrounding whitespace and treats a blank place as empty", () => {
    expect(formatPlaceDate("  Zürich ", "01.11.2026")).toBe("Zürich, 01.11.2026");
    expect(formatPlaceDate("   ", "01.11.2026")).toBe("01.11.2026");
  });

  it("is empty when both parts are empty", () => {
    expect(formatPlaceDate("", "")).toBe("");
    expect(isEmptyPlaceDate(" ", "")).toBe(true);
    expect(isEmptyPlaceDate("Łódź", "")).toBe(false);
  });
});

describe("dates", () => {
  it("formats today's local date as DD.MM.YYYY", () => {
    expect(todayDdMmYyyy(new Date(2026, 9, 17, 23, 59))).toBe("17.10.2026");
    expect(todayDdMmYyyy(new Date(2027, 0, 3, 0, 0))).toBe("03.01.2027");
  });

  it("converts between the date input's value and DD.MM.YYYY", () => {
    expect(isoToDdMmYyyy("2026-11-01")).toBe("01.11.2026");
    expect(ddMmYyyyToIso("01.11.2026")).toBe("2026-11-01");
    expect(isoToDdMmYyyy("")).toBe("");
    expect(isoToDdMmYyyy("2026-11")).toBe("");
    expect(ddMmYyyyToIso("")).toBe("");
    expect(ddMmYyyyToIso("1.11.2026")).toBe("");
  });
});
