import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 64;
const DEFAULT_COST = 16_384;
const DEFAULT_BLOCK_SIZE = 8;
const DEFAULT_PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, DEFAULT_COST, DEFAULT_BLOCK_SIZE, DEFAULT_PARALLELIZATION);
  return [
    "scrypt",
    DEFAULT_COST,
    DEFAULT_BLOCK_SIZE,
    DEFAULT_PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed || password.length > 256) return false;
  const actual = await deriveKey(password, parsed.salt, parsed.cost, parsed.blockSize, parsed.parallelization);
  return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
}

function parsePasswordHash(encodedHash: string): {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  expected: Buffer;
} | null {
  const [algorithm, costText, blockSizeText, parallelizationText, saltText, hashText, extra] =
    encodedHash.split("$");
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (
    extra !== undefined ||
    algorithm !== "scrypt" ||
    !Number.isSafeInteger(cost) ||
    cost < 2 ||
    cost > 262_144 ||
    (cost & (cost - 1)) !== 0 ||
    !Number.isSafeInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > 32 ||
    !Number.isSafeInteger(parallelization) ||
    parallelization < 1 ||
    parallelization > 16 ||
    !saltText ||
    !hashText
  ) {
    return null;
  }
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    return salt.length >= 8 && expected.length === KEY_LENGTH
      ? { cost, blockSize, parallelization, salt, expected }
      : null;
  } catch {
    return null;
  }
}

async function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelization, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(Buffer.from(derivedKey));
      },
    );
  });
}
