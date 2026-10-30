import { describe, expect, it } from "vitest";
import { describeError } from "~/lib/describe-error";

describe("describeError (SPEC 11.1: never log tokens)", () => {
  it("drops a failed query's params and keeps the cause", () => {
    const error = new Error(
      'Failed query: select * from "session" where "session"."token" = ? limit ?\nparams: 3zTWTAOUJU0hT5cAWMe9CJwtB2MRt6sz,1',
      { cause: new Error("D1_ERROR: daily row read limit exceeded") },
    );
    const logged = describeError(error);
    expect(logged).not.toContain("3zTWTAOUJU0hT5cAWMe9CJwtB2MRt6sz");
    expect(logged).toContain('Failed query: select * from "session"');
    expect(logged).toContain("cause: D1_ERROR: daily row read limit exceeded");
  });

  it("passes other values through", () => {
    expect(describeError("plain")).toBe("plain");
  });
});
