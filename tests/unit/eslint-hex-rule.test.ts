import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Proves the "no raw hex colours in components" rule (SPEC 13, static layer).
describe("eslint hex colour rule", () => {
  const eslint = new ESLint();

  async function lint(code: string, filePath: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return result!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
  }

  it("rejects hex colours in app/components", async () => {
    const messages = await lint(
      'export const C = () => <div style={{ color: "#ff0000" }} className="bg-[#abc]" />;\n',
      "app/components/example.tsx",
    );
    expect(messages).toHaveLength(2);
  });

  it("rejects hex colours in template literals in app/features", async () => {
    const messages = await lint(
      "export const c = `border: 1px solid #12345678`;\n",
      "app/features/x/ui/a.ts",
    );
    expect(messages).toHaveLength(1);
  });

  it("allows hex outside components and features", async () => {
    expect(await lint('export const c = "#ff0000";\n', "app/routes/example.ts")).toHaveLength(0);
  });

  it("does not flag anchors or ids that are not colours", async () => {
    expect(await lint('export const c = "#section-1";\n', "app/components/a.ts")).toHaveLength(0);
  });
});
