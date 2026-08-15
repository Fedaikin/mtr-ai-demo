import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "@/adapters/persistence/db";
import { canonicalJson, sha256Hex } from "@/evals/fastgate/official/attestation";

export interface DatabaseOverlayPlan {
  readonly schemaVersion: "mtr-fastgate-database-overlay-v1";
  readonly seedCommitmentSha256: string;
  readonly scenarioInstant: string;
  readonly stockQuantity: number;
  readonly requiredQuantity: number;
  readonly projectStatus: "ACTIVE" | "ON_HOLD";
  readonly snapshotId: string;
  readonly mutationIds: readonly string[];
  readonly planSha256: string;
}

export function buildDatabaseOverlayPlan(input: Readonly<{
  seed: string;
  scenarioInstant: string;
}>): DatabaseOverlayPlan {
  if (!/^[a-f0-9]{64}$/u.test(input.seed)) throw new Error("INVALID_DATABASE_OVERLAY_SEED");
  const instant = new Date(input.scenarioInstant);
  if (!Number.isFinite(instant.valueOf())) throw new Error("INVALID_DATABASE_OVERLAY_INSTANT");
  const stockQuantity = 20 + modulo(input.seed, "stock", 81);
  const requiredQuantity = 40 + modulo(input.seed, "required", 121);
  const projectStatus = modulo(input.seed, "project-status", 2) === 0 ? "ACTIVE" : "ON_HOLD";
  const snapshotId = `fastgate-${token(input.seed, "snapshot", 20)}`;
  const core = Object.freeze({
    schemaVersion: "mtr-fastgate-database-overlay-v1" as const,
    seedCommitmentSha256: sha256Hex(input.seed),
    scenarioInstant: instant.toISOString(),
    stockQuantity,
    requiredQuantity,
    projectStatus,
    snapshotId,
    mutationIds: Object.freeze([
      "FG-02_PROJECT_STATE",
      "FG-03_STOCK_SNAPSHOT",
      "FG-04_REQUIRED_COVERAGE",
      "FG-05_INTAKE_STATUS",
      "FG-06_DEADLINE_WINDOW",
      "FG-07_COMPATIBILITY_SOURCE",
      "FG-08_RULE_VERSION",
      "FG-09_SOURCE_CONFLICT_MARKER",
      "FG-11_WAREHOUSE_SCOPE_SOURCE",
    ]),
  });
  return Object.freeze({ ...core, planSha256: sha256Hex(canonicalJson(core)) });
}

/** Applies only to a disposable FastGate PGlite copy. */
export async function applyDatabaseCounterfactualOverlay(
  database: Database,
  input: Readonly<{ seed: string; scenarioInstant: string }>,
): Promise<DatabaseOverlayPlan> {
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_DATABASE_OVERLAY_REMOTE_FORBIDDEN");
  if (process.env.FASTGATE_OFFICIAL !== "1") throw new Error("FASTGATE_DATABASE_OVERLAY_OFFICIAL_ONLY");
  const plan = buildDatabaseOverlayPlan(input);
  const at = new Date(plan.scenarioInstant);
  const plusDays = (days: number) => new Date(at.valueOf() + days * 86_400_000).toISOString();

  await database.transaction(async (tx) => {
    const [project] = rows(await tx.execute(sql`
      select id from business_projects order by id limit 1
    `));
    const [material] = rows(await tx.execute(sql`
      select id, stock from operational_material_views order by material_code limit 1
    `));
    const [position] = rows(await tx.execute(sql`
      select id from business_project_positions order by position_id limit 1
    `));
    const [intake] = rows(await tx.execute(sql`
      select id from specification_intake_items order by id limit 1
    `));
    const [catalog] = rows(await tx.execute(sql`
      select id, user_id, characteristics from catalog_items order by item_code limit 1
    `));
    const [rule] = rows(await tx.execute(sql`
      select id, conditions from responsibility_rules order by id limit 1
    `));
    if (!project || !material || !position || !intake || !catalog || !rule) {
      throw new Error("FASTGATE_DATABASE_OVERLAY_BASELINE_INCOMPLETE");
    }

    const stock = record(material.stock);
    const balances = array(stock.balances).map(record);
    if (balances.length === 0) throw new Error("FASTGATE_DATABASE_OVERLAY_STOCK_INCOMPLETE");
    balances[0] = {
      ...balances[0],
      onHandQuantity: plan.stockQuantity,
      reservedQuantity: Math.min(3, Math.floor(plan.stockQuantity / 10)),
      quarantinedQuantity: 0,
    };
    const nextStock = {
      ...stock,
      snapshotId: plan.snapshotId,
      snapshotAt: plan.scenarioInstant,
      balances,
    };
    const characteristics = {
      ...record(catalog.characteristics),
      fastgateOverlay: {
        planSha256: plan.planSha256,
        contradictionMarker: true,
      },
    };
    const conditions = {
      ...record(rule.conditions),
      fastgateOverlayVersion: plan.planSha256,
    };

    await tx.execute(sql`
      update business_projects
      set status=${plan.projectStatus}, need_date=${plusDays(30)}, updated_at=${plan.scenarioInstant}
      where id=${String(project.id)}
    `);
    // The application and connector witness bootstrap independent disposable
    // databases. Pin volatile bootstrap timestamps to the signed scenario
    // instant so their full semantic projections are independently comparable.
    await tx.execute(sql`
      update operational_material_views
      set stock=jsonb_set(stock, '{snapshotAt}', to_jsonb(${plan.scenarioInstant}::text), true),
          reliability=jsonb_set(reliability, '{observedAt}', to_jsonb(${plan.scenarioInstant}::text), true),
          as_of=${plan.scenarioInstant},
          updated_at=${plan.scenarioInstant}
    `);
    await tx.execute(sql`
      update business_project_deadlines
      set due_at=case kind
        when 'DESIGN_FREEZE' then ${plusDays(2)}::timestamptz
        when 'MATERIAL_NEED' then ${plusDays(7)}::timestamptz
        else ${plusDays(20)}::timestamptz end,
        days_from_scenario_today=case kind when 'DESIGN_FREEZE' then 2 when 'MATERIAL_NEED' then 7 else 20 end,
        status=case when kind='DESIGN_FREEZE' then 'AT_RISK' else 'UPCOMING' end,
        updated_at=${plan.scenarioInstant}
      where business_project_id=${String(project.id)}
    `);
    await tx.execute(sql`
      update operational_material_views
      set stock=${JSON.stringify(nextStock)}::jsonb, as_of=${plan.scenarioInstant}, updated_at=${plan.scenarioInstant}
      where id=${String(material.id)}
    `);
    await tx.execute(sql`
      update business_project_positions
      set source_required_quantity=${String(plan.requiredQuantity)}::numeric,
          required_quantity=${String(plan.requiredQuantity)}::numeric,
          updated_at=${plan.scenarioInstant}
      where id=${String(position.id)}
    `);
    await tx.execute(sql`
      update specification_intake_items
      set status='NEEDS_REVIEW', current_step='HUMAN_REVIEW',
          received_at=${plusDays(-1)}, sla_deadline=${plusDays(1)}, updated_at=${plan.scenarioInstant}
      where id=${String(intake.id)}
    `);
    await tx.execute(sql`
      update catalog_items
      set characteristics=${JSON.stringify(characteristics)}::jsonb, updated_at=${plan.scenarioInstant}
      where id=${String(catalog.id)} and user_id=${String(catalog.user_id)}
    `);
    await tx.execute(sql`
      update responsibility_rules
      set conditions=${JSON.stringify(conditions)}::jsonb, updated_at=${plan.scenarioInstant}
      where id=${String(rule.id)}
    `);
  });
  return plan;
}

function token(seed: string, label: string, length: number): string {
  return createHash("sha256").update(`${seed}:${label}`).digest("hex").slice(0, length);
}

function modulo(seed: string, label: string, modulus: number): number {
  return Number.parseInt(token(seed, label, 8), 16) % modulus;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Array<Record<string, unknown>>
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
