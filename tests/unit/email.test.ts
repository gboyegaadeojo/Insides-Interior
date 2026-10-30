import { describe, expect, it, vi } from "vitest";
import { createEmailTransport } from "~/server/email";
import { createDevTransport } from "~/server/email/dev-transport";
import { extractLinks } from "~/server/email/links";
import { createResendTransport } from "~/server/email/resend-transport";

const FROM = "Insides Interior <hello@mail.example.ca>";

describe("createEmailTransport", () => {
  it("uses the dev transport when RESEND_API_KEY is not set", () => {
    expect(createEmailTransport({ EMAIL_FROM: FROM }).name).toBe("dev");
    expect(createEmailTransport({ EMAIL_FROM: FROM, RESEND_API_KEY: "" }).name).toBe("dev");
  });

  it("uses Resend when RESEND_API_KEY is set", () => {
    expect(createEmailTransport({ EMAIL_FROM: FROM, RESEND_API_KEY: "re_test" }).name).toBe("resend");
  });
});

describe("dev transport", () => {
  it("logs recipients, subject and every link", async () => {
    const lines: string[] = [];
    const transport = createDevTransport((line) => lines.push(line));
    const result = await transport.send({
      to: ["owner@example.ca", "staff@example.ca"],
      subject: "Sign in to Insides Interior",
      html: '<a href="https://app.example.ca/auth/verify?token=abc&amp;next=%2F">Sign in</a>',
      text: "Sign in: https://app.example.ca/auth/verify?token=abc&next=%2F\nHelp: https://example.ca/help",
    });
    const output = lines.join("\n");
    expect(result.transport).toBe("dev");
    expect(output).toContain("to:      owner@example.ca, staff@example.ca");
    expect(output).toContain("subject: Sign in to Insides Interior");
    expect(output).toContain("https://app.example.ca/auth/verify?token=abc&next=%2F");
    expect(output).toContain("https://example.ca/help");
  });
});

describe("extractLinks", () => {
  it("de-duplicates and ignores non-http links", () => {
    expect(
      extractLinks('<a href="mailto:a@b.ca">x</a><a href="https://a.ca/q/1">y</a>', "https://a.ca/q/1"),
    ).toEqual(["https://a.ca/q/1"]);
  });
});

describe("resend transport", () => {
  it("posts to Resend with the idempotency key and default sender", async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: "re_123" }));
    const transport = createResendTransport({
      apiKey: "re_test",
      defaultFrom: FROM,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await transport.send({
      to: "client@example.ca",
      subject: "Your quote",
      html: "<p>Hi</p>",
      idempotencyKey: "quote:1:quote-sent",
    });

    expect(result).toEqual({ id: "re_123", transport: "resend" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test");
    expect(headers["Idempotency-Key"]).toBe("quote:1:quote-sent");
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: FROM,
      to: ["client@example.ca"],
      subject: "Your quote",
    });
  });

  it("throws with Resend's error on failure", async () => {
    const transport = createResendTransport({
      apiKey: "re_test",
      defaultFrom: FROM,
      fetch: (async () => new Response('{"name":"validation_error"}', { status: 422 })) as typeof fetch,
    });
    await expect(transport.send({ to: "x@example.ca", subject: "s", text: "t" })).rejects.toThrow(
      /422.*validation_error/,
    );
  });
});

describe("Resend errors", () => {
  it("treats refusals as permanent and timeouts, rate limits and outages as retryable", async () => {
    const { EmailSendError } = await import("~/server/email/resend-transport");
    expect(
      new EmailSendError(403, "You can only send testing emails to your own email address").permanent,
    ).toBe(true);
    expect(new EmailSendError(422, "Invalid `to` field").permanent).toBe(true);
    expect(new EmailSendError(429, "Too many requests").permanent).toBe(false);
    expect(new EmailSendError(408, "Timeout").permanent).toBe(false);
    expect(new EmailSendError(500, "Internal").permanent).toBe(false);
    expect(new EmailSendError(403, "x").message).toContain("(403)");
  });
});
