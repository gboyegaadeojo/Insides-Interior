import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvMoney, toCsv } from "~/lib/csv";
import { crc32, zip } from "~/lib/zip";

describe("CSV (FR-RPT-05)", () => {
  it("starts with the real byte-order mark character", () => {
    expect(toCsv(["a"], []).charCodeAt(0)).toBe(0xfeff);
  });

  it("writes BOM, CRLF and plain amounts", () => {
    const csv = toCsv(
      ["Number", "Total"],
      [
        ["INV-1", csvMoney(12_195_056)],
        ["INV-2", csvMoney(-5)],
      ],
    );
    expect(csv).toBe("\uFEFFNumber,Total\r\nINV-1,121950.56\r\nINV-2,-0.05\r\n");
  });

  it("quotes commas, quotes and newlines; blanks nulls", () => {
    expect(toCsv(["a", "b", "c"], [['Obi, "Amaka"', "two\nlines", null]])).toBe(
      '\uFEFFa,b,c\r\n"Obi, ""Amaka""","two\nlines",\r\n',
    );
    expect(toCsv(["n"], [[undefined], [42]])).toBe("\uFEFFn\r\n\r\n42\r\n");
  });

  it("defuses formulas but keeps negative numbers", () => {
    expect(toCsv(["x"], [["=HYPERLINK(1)"], ["@SUM"], ["+1"], ["-12.50"], ["-x"]])).toBe(
      "\uFEFFx\r\n'=HYPERLINK(1)\r\n'@SUM\r\n'+1\r\n-12.50\r\n'-x\r\n",
    );
  });
});

describe("ZIP", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes an archive that the platform's unzip can read", () => {
    const bytes = zip(
      [
        { name: "invoices.csv", data: toCsv(["Total"], [["1.00"]]) },
        { name: "pdfs/INV-1 ₦.pdf", data: new Uint8Array([37, 80, 68, 70]) },
      ],
      new Date(2026, 9, 29, 13, 5, 10),
    );
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(file, bytes);
    // Python's zipfile checks every CRC (-t) and lists names (-l).
    const opts = { cwd: dir, encoding: "utf8" as const, env: { ...process.env, PYTHONIOENCODING: "utf-8" } };
    let listing = "";
    for (const python of ["python3", "python", "py"]) {
      try {
        execFileSync(python, ["-m", "zipfile", "-t", "t.zip"], opts);
        listing = execFileSync(python, ["-m", "zipfile", "-l", "t.zip"], opts);
        break;
      } catch {
        // Try the next name.
      }
    }
    expect(listing).toContain("invoices.csv");
    expect(listing).toContain("pdfs/");
  });
});
