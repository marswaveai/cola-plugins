import { describe, expect, it } from "vitest";
import { parseAuthorizedOpenIds } from "../src/auth/authorized-open-ids.js";

describe("Feishu authorized open_id parsing", () => {
  it("normalizes comma and whitespace separated open_id values", () => {
    expect([...parseAuthorizedOpenIds(" ou_1,ou_2\nou_3  ,, ")]).toEqual(["ou_1", "ou_2", "ou_3"]);
  });

  it("accepts string arrays and ignores blank values", () => {
    expect([...parseAuthorizedOpenIds(["ou_1", " ", " ou_2 "])]).toEqual(["ou_1", "ou_2"]);
  });

  it("returns an empty set for unsupported values", () => {
    expect(parseAuthorizedOpenIds(undefined).size).toBe(0);
    expect(parseAuthorizedOpenIds(42).size).toBe(0);
  });
});
