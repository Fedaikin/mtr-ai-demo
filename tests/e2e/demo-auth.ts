/**
 * Public local-test credential only. The deployed demo seed uses a different
 * private password and remote E2E must provide E2E_DEMO_PASSWORD explicitly.
 */
export const E2E_DEMO_LOGIN = process.env.E2E_DEMO_LOGIN ?? "demo";
export const E2E_DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "MtrLocalTestOnly!";
