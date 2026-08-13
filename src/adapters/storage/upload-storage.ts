import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function storeUploadedBytes(input: {
  safeName: string;
  data: Uint8Array;
  contentType: string;
}): Promise<{ url: string; provider: "vercel-blob" | "filesystem" | "memory" }> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`mtr-demo/${input.safeName}`, Buffer.from(input.data), {
      access: "private",
      addRandomSuffix: true,
      contentType: input.contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url, provider: "vercel-blob" };
  }

  if (process.env.VERCEL) {
    throw new Error("Для загрузок в Vercel настройте BLOB_READ_WRITE_TOKEN. Эфемерная файловая система не используется.");
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { url: `memory://uploads/${encodeURIComponent(input.safeName)}`, provider: "memory" };
  }

  const directory = resolve(process.cwd(), ".data", "uploads");
  await mkdir(directory, { recursive: true });
  const target = resolve(directory, input.safeName);
  if (!target.startsWith(`${directory}/`)) throw new Error("Некорректное имя файла");
  await writeFile(target, input.data, { flag: "wx", mode: 0o600 });
  return { url: `local-upload://${encodeURIComponent(input.safeName)}`, provider: "filesystem" };
}

export async function readUploadedBytes(storageUrl: string): Promise<ReadableStream<Uint8Array> | Uint8Array | null> {
  if (storageUrl.startsWith("local-upload://")) {
    const safeName = decodeURIComponent(storageUrl.slice("local-upload://".length));
    const directory = resolve(process.cwd(), ".data", "uploads");
    const target = resolve(directory, safeName);
    if (!target.startsWith(`${directory}/`)) throw new Error("Некорректное имя файла");
    try {
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  if (storageUrl.startsWith("https://")) {
    const { get } = await import("@vercel/blob");
    const result = await get(storageUrl, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return result?.statusCode === 200 ? result.stream : null;
  }

  return null;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
