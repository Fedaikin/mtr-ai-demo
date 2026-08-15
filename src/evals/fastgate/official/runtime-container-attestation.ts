export const FASTGATE_RUNTIME_SERVICE_POLICY = Object.freeze({
  application: Object.freeze({
    networks: Object.freeze(["fastgate-proxy-application"]),
    mounts: Object.freeze({
      "/run/fastgate-public": false,
      "/run/fastgate-database": true,
      "/opt/fastgate-control": true,
    }),
  }),
  "connector-witness": Object.freeze({
    networks: Object.freeze(["fastgate-supervisor-witness", "fastgate-proxy-witness"]),
    mounts: Object.freeze({
      "/run/fastgate-public": false,
      "/run/fastgate-private": true,
      "/run/fastgate-artifacts": true,
      "/run/fastgate-control": false,
      "/run/fastgate-witness-database": true,
    }),
  }),
  "http-proxy": Object.freeze({
    networks: Object.freeze(["fastgate-supervisor-proxy", "fastgate-proxy-application", "fastgate-proxy-witness"]),
    mounts: Object.freeze({
      "/run/fastgate-artifacts": true,
      "/run/fastgate-control": false,
    }),
  }),
  supervisor: Object.freeze({
    networks: Object.freeze(["fastgate-supervisor-proxy", "fastgate-supervisor-witness"]),
    mounts: Object.freeze({
      "/run/fastgate-public": true,
      "/run/fastgate-private": true,
      "/run/fastgate-artifacts": true,
      "/run/fastgate-proxy-artifacts": false,
      "/run/fastgate-witness-artifacts": false,
      "/run/fastgate-control": true,
      "/run/fastgate-database": false,
    }),
  }),
} as const);

export type FastGateRuntimeService = keyof typeof FASTGATE_RUNTIME_SERVICE_POLICY;

export interface RuntimeContainerAttestation {
  readonly service: FastGateRuntimeService;
  readonly imageDigest: string;
  readonly user: "1000:1000";
  readonly readonlyRootfs: true;
  readonly capDropAll: true;
  readonly noNewPrivileges: true;
  readonly privileged: false;
  readonly hostNamespacesAbsent: true;
  readonly hostPortBindingsAbsent: true;
  readonly dockerSocketAbsent: true;
  readonly bindMountsAbsent: true;
  readonly extraDevicesAbsent: true;
  readonly initEnabled: true;
  readonly restartDisabled: true;
  readonly tmpfsRestricted: true;
  readonly mounts: readonly Readonly<{ destination: string; readWrite: boolean; type: "volume" }>[];
  readonly networks: readonly Readonly<{ logicalName: string; internal: true }>[];
  readonly verified: true;
}

export function attestRuntimeContainer(input: Readonly<{
  service: FastGateRuntimeService;
  expectedImageDigest: string;
  inspect: unknown;
  internalNetworkIds: ReadonlySet<string>;
}>): RuntimeContainerAttestation {
  const value = record(input.inspect, "RUNTIME_CONTAINER_INSPECT_INVALID");
  const config = record(value.Config, "RUNTIME_CONTAINER_CONFIG_INVALID");
  const host = record(value.HostConfig, "RUNTIME_CONTAINER_HOST_CONFIG_INVALID");
  const networkSettings = record(value.NetworkSettings, "RUNTIME_CONTAINER_NETWORK_SETTINGS_INVALID");
  const networks = record(networkSettings.Networks, "RUNTIME_CONTAINER_NETWORKS_INVALID");
  const policy = FASTGATE_RUNTIME_SERVICE_POLICY[input.service];
  const errors: string[] = [];

  const actualImage = string(value.Image);
  if (actualImage !== input.expectedImageDigest) errors.push("IMAGE_DIGEST");
  if (config.User !== "1000:1000") errors.push("USER");
  if (host.ReadonlyRootfs !== true) errors.push("READONLY_ROOTFS");
  if (host.Privileged !== false) errors.push("PRIVILEGED");
  if (host.Init !== true) errors.push("INIT");

  const capDrop = stringArray(host.CapDrop).map((item) => item.toUpperCase());
  const capAdd = stringArray(host.CapAdd);
  if (!capDrop.includes("ALL") || capAdd.length !== 0) errors.push("CAPABILITIES");
  const securityOptions = stringArray(host.SecurityOpt);
  if (!securityOptions.some((item) => item === "no-new-privileges" || item === "no-new-privileges:true")) {
    errors.push("NO_NEW_PRIVILEGES");
  }
  if (nonEmpty(host.PidMode) || nonEmpty(host.UTSMode) || !["", "private"].includes(string(host.IpcMode))) {
    errors.push("HOST_NAMESPACES");
  }
  if (stringArray(host.GroupAdd).length || array(host.Devices).length) errors.push("EXTRA_DEVICE_OR_GROUP");
  if (host.PortBindings !== null && Object.keys(optionalRecord(host.PortBindings)).length) errors.push("HOST_PORTS");
  const hostBinds = stringArray(host.Binds);
  if (hostBinds.some((binding) => binding.split(":", 1)[0]?.startsWith("/") || binding.includes("docker.sock"))) {
    errors.push("BIND_MOUNTS");
  }
  const restart = optionalRecord(host.RestartPolicy);
  if (restart.Name !== "no") errors.push("RESTART_POLICY");
  const tmpfs = optionalRecord(host.Tmpfs);
  if (Object.keys(tmpfs).length !== 1 || typeof tmpfs["/tmp"] !== "string"
    || !String(tmpfs["/tmp"]).includes("mode=1777")
    || !(String(tmpfs["/tmp"]).includes("size=128m") || String(tmpfs["/tmp"]).includes("size=134217728"))) {
    errors.push("TMPFS");
  }

  const rawMounts = array(value.Mounts).map((mount) => record(mount, "RUNTIME_CONTAINER_MOUNT_INVALID"));
  const projectedMounts = rawMounts.map((mount) => ({
    destination: string(mount.Destination),
    readWrite: mount.RW === true,
    type: string(mount.Type),
  }));
  if (projectedMounts.some((mount) => mount.type !== "volume")) errors.push("NON_VOLUME_MOUNT");
  if (rawMounts.some((mount) => `${string(mount.Source)} ${string(mount.Destination)}`.includes("docker.sock"))) {
    errors.push("DOCKER_SOCKET");
  }
  const expectedMounts = Object.entries(policy.mounts).sort(([left], [right]) => left.localeCompare(right));
  const actualMounts = projectedMounts
    .map((mount) => [mount.destination, mount.readWrite] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(actualMounts) !== JSON.stringify(expectedMounts)) errors.push("MOUNTS");

  const logicalNetworks = Object.entries(networks).map(([runtimeName, detail]) => {
    const network = record(detail, "RUNTIME_CONTAINER_NETWORK_INVALID");
    const logicalName = policy.networks.find((candidate) => runtimeName === candidate || runtimeName.endsWith(`_${candidate}`));
    const networkId = string(network.NetworkID);
    if (!logicalName || !networkId || !input.internalNetworkIds.has(networkId)) errors.push(`NETWORK:${runtimeName}`);
    return logicalName ?? runtimeName;
  }).sort();
  const expectedNetworks = [...policy.networks].sort();
  if (JSON.stringify(logicalNetworks) !== JSON.stringify(expectedNetworks)) errors.push("NETWORK_SET");

  if (errors.length) throw new Error(`RUNTIME_CONTAINER_ISOLATION_INVALID:${input.service}:${errors.join(",")}`);
  return Object.freeze({
    service: input.service,
    imageDigest: input.expectedImageDigest,
    user: "1000:1000",
    readonlyRootfs: true,
    capDropAll: true,
    noNewPrivileges: true,
    privileged: false,
    hostNamespacesAbsent: true,
    hostPortBindingsAbsent: true,
    dockerSocketAbsent: true,
    bindMountsAbsent: true,
    extraDevicesAbsent: true,
    initEnabled: true,
    restartDisabled: true,
    tmpfsRestricted: true,
    mounts: Object.freeze(actualMounts.map(([destination, readWrite]) => Object.freeze({ destination, readWrite, type: "volume" as const }))),
    networks: Object.freeze(expectedNetworks.map((logicalName) => Object.freeze({ logicalName, internal: true as const }))),
    verified: true,
  });
}

function record(value: unknown, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === "string");
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonEmpty(value: unknown): boolean {
  return string(value).trim().length > 0;
}
