import { attestRuntimeContainer } from "@/evals/fastgate/official/runtime-container-attestation";

describe("official runtime container attestation", () => {
  it("accepts only the exact effective isolation boundary", () => {
    expect(attestRuntimeContainer({
      service: "application",
      expectedImageDigest: `sha256:${"a".repeat(64)}`,
      inspect: applicationInspect(),
      internalNetworkIds: new Set(["network-internal"]),
    })).toMatchObject({
      verified: true,
      dockerSocketAbsent: true,
      bindMountsAbsent: true,
      hostPortBindingsAbsent: true,
      networks: [{ logicalName: "fastgate-proxy-application", internal: true }],
    });
  });

  it.each([
    ["Docker socket bind", (value: ReturnType<typeof applicationInspect>) => ({
      ...value,
      Mounts: [...value.Mounts, { Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: true }],
    })],
    ["external network", (value: ReturnType<typeof applicationInspect>) => value],
    ["host port", (value: ReturnType<typeof applicationInspect>) => ({
      ...value,
      HostConfig: { ...value.HostConfig, PortBindings: { "3000/tcp": [{ HostPort: "3000" }] } },
    })],
    ["added capability", (value: ReturnType<typeof applicationInspect>) => ({
      ...value,
      HostConfig: { ...value.HostConfig, CapAdd: ["SYS_ADMIN"] },
    })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => attestRuntimeContainer({
      service: "application",
      expectedImageDigest: `sha256:${"a".repeat(64)}`,
      inspect: mutate(applicationInspect()),
      internalNetworkIds: new Set(_label === "external network" ? [] : ["network-internal"]),
    })).toThrow(/RUNTIME_CONTAINER_ISOLATION_INVALID/u);
  });
});

function applicationInspect() {
  return {
    Image: `sha256:${"a".repeat(64)}`,
    Config: { User: "1000:1000" },
    HostConfig: {
      ReadonlyRootfs: true,
      Privileged: false,
      Init: true,
      CapDrop: ["ALL"],
      CapAdd: null,
      SecurityOpt: ["no-new-privileges:true"],
      PidMode: "",
      UTSMode: "",
      IpcMode: "private",
      GroupAdd: null,
      Devices: null,
      PortBindings: {},
      Binds: null,
      RestartPolicy: { Name: "no" },
      Tmpfs: { "/tmp": "size=128m,mode=1777" },
    },
    Mounts: [
      { Type: "volume", Source: "/vm/volumes/public", Destination: "/run/fastgate-public", RW: false },
      { Type: "volume", Source: "/vm/volumes/database", Destination: "/run/fastgate-database", RW: true },
      { Type: "volume", Source: "/vm/volumes/bootstrap", Destination: "/opt/fastgate-control", RW: true },
    ],
    NetworkSettings: { Networks: { "project_fastgate-proxy-application": { NetworkID: "network-internal" } } },
  };
}
