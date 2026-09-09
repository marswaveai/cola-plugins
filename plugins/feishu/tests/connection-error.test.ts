import { describe, expect, it } from "vitest";
import { describeConnectionError } from "../src/gateway/connection-error.js";

describe("connection diagnostics", () => {
  it("keeps error messages and API codes without request credentials", () => {
    const error = Object.assign(new Error("Request failed"), {
      response: { data: { code: 10013, msg: "app secret invalid" } },
      config: { headers: { Authorization: "private-token" }, appSecret: "private-secret" },
    });
    expect(describeConnectionError(error)).toBe("Request failed; code: 10013; app secret invalid");
  });

  it("unwraps the SDK logger's nested argument arrays", () => {
    expect(describeConnectionError([["[ws]", "code: 514, invalid credentials"]])).toBe(
      "code: 514, invalid credentials",
    );
  });

  it.each([undefined, null, {}, new Error(), ["[ws]", " "]])(
    "provides a nonempty fallback for an empty error: %s",
    (error) => expect(describeConnectionError(error)).toBe("Feishu connection failed"),
  );

  it("bounds long errors and handles circular causes", () => {
    const error = new Error("Connection failed");
    error.cause = error;
    expect(describeConnectionError(error)).toBe("Connection failed");
    expect(describeConnectionError("x".repeat(2000))).toHaveLength(1000);
  });
});
