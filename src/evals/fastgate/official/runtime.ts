import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

export type FastGateContainerRuntime = "docker" | "podman" | "colima";

export interface FastGateRuntimeInspection {
  readonly ready: boolean;
  readonly selectedRuntime: FastGateContainerRuntime | null;
  readonly availableRuntimes: readonly FastGateContainerRuntime[];
  readonly platform: string;
  readonly arch: string;
  readonly blockers: readonly string[];
}

export function isAcceptedDockerIsolation(input: Readonly<{
  context: string;
  endpoint: string;
  homeDirectory: string;
  colimaStatusOk: boolean;
  securityOptions: string;
}>): boolean {
  const security = input.securityOptions.toLowerCase();
  if (security.includes("rootless") || security.includes("docker desktop")) return true;
  if (!/^colima(?:$|-)/u.test(input.context.trim())) return false;
  if (!input.colimaStatusOk) return false;
  const home = input.homeDirectory.replace(/\/+$/u, "");
  const expectedPrefix = `unix://${home}/.colima/`;
  return home.length > 1 && input.endpoint.trim().startsWith(expectedPrefix);
}

export async function inspectFastGateRuntime(input: Readonly<{
  commandAvailable?: (command: string) => Promise<boolean>;
  platform?: string;
  arch?: string;
}> = {}): Promise<FastGateRuntimeInspection> {
  const commandAvailable = input.commandAvailable ?? commandExists;
  const runtimes = ["docker", "podman", "colima"] as const;
  const availability = await Promise.all(runtimes.map(async (runtime) => [runtime, await commandAvailable(runtime)] as const));
  const availableRuntimes = availability.filter(([, available]) => available).map(([runtime]) => runtime);
  const selectedRuntime = availableRuntimes[0] ?? null;
  return Object.freeze({
    ready: selectedRuntime !== null,
    selectedRuntime,
    availableRuntimes: Object.freeze(availableRuntimes),
    platform: input.platform ?? process.platform,
    arch: input.arch ?? process.arch,
    blockers: Object.freeze(selectedRuntime ? [] : ["DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE"]),
  });
}

export function buildScopedCleanupPlan(input: Readonly<{
  runtime: FastGateContainerRuntime;
  projectName: string;
}>): Readonly<{ command: readonly string[] }> {
  if (!/^mtr-fastgate-official-[a-z0-9][a-z0-9-]{0,63}$/u.test(input.projectName)) throw new Error("UNSAFE_FASTGATE_PROJECT_NAME");
  if (input.runtime === "docker") return Object.freeze({ command: Object.freeze(["docker", "compose", "--project-name", input.projectName, "down", "--volumes", "--remove-orphans"]) });
  if (input.runtime === "podman") return Object.freeze({ command: Object.freeze(["podman", "compose", "--project-name", input.projectName, "down", "--volumes", "--remove-orphans"]) });
  return Object.freeze({ command: Object.freeze(["docker", "compose", "--project-name", input.projectName, "down", "--volumes", "--remove-orphans"]) });
}

async function commandExists(command: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const directory of paths) {
    try {
      await access(join(directory, command), constants.X_OK);
      return true;
    } catch {
      // Continue through PATH without executing an untrusted binary.
    }
  }
  return false;
}
