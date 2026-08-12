import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

const PDF_FONT_TRACE_PATHS = [
  "./node_modules/@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff",
  "./node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
] as const;

describe("ACC-FUNC-004: PDF font runtime assets", () => {
  it("traces both exact top-level WOFF paths used by the PDF exporter", () => {
    const tracedFiles = nextConfig.outputFileTracingIncludes?.["/*"] ?? [];

    expect(tracedFiles).toEqual(expect.arrayContaining([...PDF_FONT_TRACE_PATHS]));
  });
});
