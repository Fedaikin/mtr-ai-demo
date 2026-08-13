ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'ACTIVE';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_type" text NOT NULL DEFAULT 'HUMAN';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_source" text NOT NULL DEFAULT 'DEMO';
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_subject_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authorization_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_account_type_check";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_type_check" CHECK ("account_type" IN ('HUMAN', 'SERVICE_ACCOUNT'));
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_status_check";
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("status" IN ('ACTIVE', 'BLOCKED'));
--> statement-breakpoint

ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "authorization_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "activated_role_assignment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "roles" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "name_ru" text NOT NULL,
  "scope_type" text NOT NULL CHECK ("scope_type" IN ('GLOBAL', 'PROJECT', 'SERVICE')),
  "description_ru" text NOT NULL,
  "is_builtin" boolean NOT NULL DEFAULT true,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
  "key" text PRIMARY KEY,
  "resource" text NOT NULL,
  "action" text NOT NULL,
  "name_ru" text NOT NULL,
  "description_ru" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role_id" text NOT NULL REFERENCES "roles"("id"),
  "permission_key" text NOT NULL REFERENCES "permissions"("key"),
  PRIMARY KEY ("role_id", "permission_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_hierarchy" (
  "senior_role_id" text NOT NULL REFERENCES "roles"("id"),
  "junior_role_id" text NOT NULL REFERENCES "roles"("id"),
  PRIMARY KEY ("senior_role_id", "junior_role_id"),
  CHECK ("senior_role_id" <> "junior_role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "id" text PRIMARY KEY,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  "classification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_memberships" (
  "project_id" text NOT NULL REFERENCES "projects"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'EXPIRED')),
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_until" timestamptz,
  "added_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("project_id", "user_id"),
  CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_assignments" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "role_id" text NOT NULL REFERENCES "roles"("id"),
  "scope_type" text NOT NULL CHECK ("scope_type" IN ('GLOBAL', 'PROJECT', 'SERVICE')),
  "project_id" text REFERENCES "projects"("id"),
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED')),
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_until" timestamptz,
  "assigned_by" text NOT NULL REFERENCES "users"("id"),
  "revoked_by" text REFERENCES "users"("id"),
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("scope_type" = 'PROJECT' AND "project_id" IS NOT NULL) OR ("scope_type" IN ('GLOBAL', 'SERVICE') AND "project_id" IS NULL)),
  CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_role_assignment" ON "role_assignments" ("user_id", "role_id", "scope_type", COALESCE("project_id", '__GLOBAL__')) WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_conflicts" (
  "role_id" text NOT NULL REFERENCES "roles"("id"),
  "conflicting_role_id" text NOT NULL REFERENCES "roles"("id"),
  "environment_scope" text NOT NULL DEFAULT 'CURRENT_ENVIRONMENT',
  PRIMARY KEY ("role_id", "conflicting_role_id"),
  CHECK ("role_id" <> "conflicting_role_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_source_access_claims" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "claim_type" text NOT NULL,
  "claim_value" text NOT NULL,
  "source" text NOT NULL,
  "valid_until" timestamptz,
  UNIQUE ("user_id", "claim_type", "claim_value", "source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_scopes" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "name_ru" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  "classification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_scopes" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "source_type" text NOT NULL CHECK ("source_type" IN ('SAP', 'NORMATIVE', 'SYSTEM_CONFIG')),
  "name_ru" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  "classification" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

INSERT INTO "roles" ("id", "key", "name_ru", "scope_type", "description_ru") VALUES
 ('role-system-admin','SYSTEM_ADMIN','Системный администратор','GLOBAL','Техническое управление системой без автоматического доступа к бизнес-данным'),
 ('role-auditor','AUDITOR','Аудитор','GLOBAL','Независимый просмотр аудита и истории изменений'),
 ('role-integration-service','INTEGRATION_SERVICE','Интеграционная служба','SERVICE','Неинтерактивный доступ интеграций'),
 ('role-project-viewer','PROJECT_VIEWER','Наблюдатель проекта','PROJECT','Чтение опубликованных проектных данных'),
 ('role-mtr-analyst','MTR_ANALYST','Аналитик МТР','PROJECT','Загрузка данных и запуск анализа'),
 ('role-mtr-expert','MTR_EXPERT','Эксперт МТР','PROJECT','Экспертная проверка результатов'),
 ('role-project-manager','PROJECT_MANAGER','Руководитель проекта','PROJECT','Управление проектом и публикация результатов')
ON CONFLICT ("id") DO UPDATE SET "name_ru"=EXCLUDED."name_ru", "description_ru"=EXCLUDED."description_ru", "active"=true;
--> statement-breakpoint

INSERT INTO "permissions" ("key","resource","action","name_ru","description_ru") VALUES
 ('profile.read.own','profile','read.own','Свой профиль','Читать собственный профиль'),
 ('project.read','project','read','Проект','Видеть доступный проект'),('project.members.manage','project.members','manage','Участники проекта','Управлять участниками проекта'),
 ('specification.read','specification','read','Спецификации','Читать доступные спецификации'),('specification.history.read','specification.history','read','История спецификаций','Читать историю версий'),('specification.upload','specification','upload','Загрузка спецификаций','Загружать черновики'),('specification.publish','specification','publish','Публикация спецификаций','Передавать спецификацию в проект'),('specification.archive','specification','archive','Архивация спецификаций','Архивировать спецификации'),
 ('catalog.read','catalog','read','Промышленный каталог','Читать карточки без складских остатков'),('catalog.substitutes.read','catalog.substitutes','read','Замены','Читать подтвержденные замены'),('catalog.bom.read','catalog.bom','read','BOM','Читать состав узлов'),
 ('stock.search','stock','search','Остатки','Искать материалы и остатки'),('stock.import','stock','import','Импорт SAP','Загружать SAP-выгрузку'),
 ('analysis.create','analysis','create','Запуск анализа','Создавать анализ'),('analysis.read','analysis','read','Запуски','Читать проектные запуски'),('analysis.cancel.own','analysis','cancel.own','Отмена своего запуска','Отменять собственный запуск'),('analysis.cancel.any','analysis','cancel.any','Отмена запусков','Отменять любой запуск проекта'),('analysis.retry.own','analysis','retry.own','Повтор своего запуска','Повторять собственный запуск'),('analysis.retry.any','analysis','retry.any','Повтор запусков','Повторять любой запуск проекта'),
 ('review.read','review','read','Статус экспертизы','Читать доступные решения'),('review.queue.read','review.queue','read','Экспертная очередь','Читать очередь экспертизы'),('review.assign','review','assign','Назначение экспертов','Назначать эксперта'),('review.decide','review','decide','Экспертное решение','Принимать решение'),('result.override','result','override','Корректировка результата','Корректировать результат с причиной'),
 ('report.read','report','read','Отчеты','Читать доступные отчеты'),('report.publish','report','publish','Публикация отчета','Публиковать итоговый отчет'),('report.archive','report','archive','Архивация отчета','Архивировать отчет'),('report.export','report','export','Экспорт отчета','Выгружать отчет'),
 ('agent.chat','agent','chat','МТР-агент','Использовать личный чат'),('agent.logs.read','agent.logs','read','Логи агента','Читать редактированные технические логи'),
 ('user.manage','user','manage','Пользователи','Управлять пользователями'),('global_role.manage','global_role','manage','Глобальные роли','Управлять глобальными назначениями'),('integration.read','integration','read','Интеграции','Читать состояние интеграций'),('integration.manage','integration','manage','Управление интеграциями','Изменять интеграции'),('prompt.manage','prompt','manage','Промпты','Создавать версии prompt'),('prompt.activate','prompt','activate','Активация prompt','Активировать prompt'),('dictionary.manage','dictionary','manage','Словари','Управлять словарями'),('scenario_template.manage','scenario_template','manage','Шаблоны сценариев','Управлять шаблонами сценариев'),
 ('audit.read.own','audit','read.own','Собственные действия','Читать собственные действия'),('audit.read.project','audit','read.project','Аудит проекта','Читать проектный аудит'),('audit.read.global','audit','read.global','Глобальный аудит','Читать глобальный аудит'),('audit.export','audit','export','Экспорт аудита','Выгружать аудит'),
 ('demo.reset','demo','reset','Сброс демо','Сбрасывать синтетические данные'),('demo.catalog.reset','demo.catalog','reset','Сброс каталога','Переинициализировать каталог'),
 ('source.appius.read','source.appius','read','Appius PLM','Читать Appius'),('source.sap.read','source.sap','read','SAP S/4HANA','Читать SAP'),('source.rag.read','source.rag','read','Нормативные источники','Читать RAG'),('sink.siem.write','sink.siem','write','SIEM','Передавать аудит в SIEM')
ON CONFLICT ("key") DO UPDATE SET "name_ru"=EXCLUDED."name_ru", "description_ru"=EXCLUDED."description_ru";
--> statement-breakpoint

INSERT INTO "role_hierarchy" VALUES ('role-mtr-analyst','role-project-viewer'),('role-mtr-expert','role-project-viewer'),('role-project-manager','role-mtr-analyst') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_conflicts" VALUES
 ('role-auditor','role-system-admin','CURRENT_ENVIRONMENT'),('role-system-admin','role-auditor','CURRENT_ENVIRONMENT'),
 ('role-auditor','role-mtr-analyst','CURRENT_ENVIRONMENT'),('role-auditor','role-mtr-expert','CURRENT_ENVIRONMENT'),('role-auditor','role-project-manager','CURRENT_ENVIRONMENT')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id","permission_key")
SELECT 'role-project-viewer', unnest(ARRAY['profile.read.own','project.read','specification.read','specification.history.read','catalog.read','catalog.substitutes.read','catalog.bom.read','analysis.read','review.read','report.read','report.export','agent.chat','audit.read.own']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-mtr-analyst', unnest(ARRAY['specification.upload','specification.publish','stock.search','stock.import','analysis.create','analysis.cancel.own','analysis.retry.own']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-mtr-expert', unnest(ARRAY['stock.search','analysis.create','analysis.cancel.own','analysis.retry.own','review.queue.read','review.decide','result.override']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-project-manager', unnest(ARRAY['project.members.manage','specification.archive','analysis.cancel.any','analysis.retry.any','review.queue.read','review.assign','report.publish','report.archive','audit.read.project']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-system-admin', unnest(ARRAY['profile.read.own','user.manage','global_role.manage','integration.read','integration.manage','prompt.manage','prompt.activate','dictionary.manage','scenario_template.manage','agent.logs.read','audit.read.global','demo.reset','demo.catalog.reset']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-auditor', unnest(ARRAY['profile.read.own','agent.logs.read','audit.read.global','audit.export']) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" SELECT 'role-integration-service', unnest(ARRAY['source.appius.read','source.sap.read','source.rag.read','sink.siem.write']) ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "users" ("id","user_id","login","password_hash","display_name","roles","locale","is_synthetic_demo","created_by","status","account_type","auth_source") VALUES
 ('demo-user-001','demo-user-001','demo','scrypt$16384$8$1$bXRyLWRlbW8tYXV0aC12MQ$GcR_B-AFou6BJpPfLHVa0afwkfnOh5_ehbSyTSL2TFn7UARDrszHNcwtC19lk40LVfg7sGA_roL4NX7hUkexBA','Демо-пользователь 1','["USER","ADMIN"]'::jsonb,'ru-RU',true,'demo-user-001','ACTIVE','HUMAN','DEMO')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "projects" ("id","code","name","status","created_by") VALUES ('demo-project-001','PROJECT-DEMO','Демонстрационный проект анализа МТР','ACTIVE','demo-user-001') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "catalog_scopes" ("id","key","name_ru","status","created_by") VALUES ('demo-catalog-001','DEMO_CATALOG','Промышленный каталог МТР','ACTIVE','demo-user-001') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "source_scopes" ("id","key","source_type","name_ru","status","created_by") VALUES
 ('demo-sap-001','DEMO_SAP','SAP','SAP S/4HANA demo','ACTIVE','demo-user-001'),('demo-normative-001','DEMO_NORMATIVE','NORMATIVE','Нормативная база demo','ACTIVE','demo-user-001'),('demo-system-config-001','DEMO_SYSTEM_CONFIG','SYSTEM_CONFIG','Системная конфигурация demo','ACTIVE','demo-user-001') ON CONFLICT DO NOTHING;
--> statement-breakpoint

ALTER TABLE "specifications" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "specification_versions" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "specification_positions" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "scenario_runs" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "scenario_run_steps" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "position_analysis_results" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "project_id" text REFERENCES "projects"("id");
--> statement-breakpoint
UPDATE "specifications" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "specification_versions" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "specification_positions" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "scenario_runs" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "scenario_run_steps" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "position_analysis_results" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint
UPDATE "uploaded_files" SET "project_id"='demo-project-001' WHERE "project_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "catalog_interchangeability_families" ADD COLUMN IF NOT EXISTS "catalog_scope_id" text REFERENCES "catalog_scopes"("id");
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "catalog_scope_id" text REFERENCES "catalog_scopes"("id");
--> statement-breakpoint
ALTER TABLE "catalog_stock_balances" ADD COLUMN IF NOT EXISTS "catalog_scope_id" text REFERENCES "catalog_scopes"("id");
--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ADD COLUMN IF NOT EXISTS "catalog_scope_id" text REFERENCES "catalog_scopes"("id");
--> statement-breakpoint
UPDATE "catalog_interchangeability_families" SET "catalog_scope_id"='demo-catalog-001' WHERE "catalog_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "catalog_items" SET "catalog_scope_id"='demo-catalog-001' WHERE "catalog_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "catalog_stock_balances" SET "catalog_scope_id"='demo-catalog-001' WHERE "catalog_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "catalog_bom_components" SET "catalog_scope_id"='demo-catalog-001' WHERE "catalog_scope_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "specifications" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "specification_versions" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "specification_positions" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "scenario_runs" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "scenario_run_steps" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "position_analysis_results" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "uploaded_files" ALTER COLUMN "project_id" SET DEFAULT 'demo-project-001';
--> statement-breakpoint
ALTER TABLE "catalog_interchangeability_families" ALTER COLUMN "catalog_scope_id" SET DEFAULT 'demo-catalog-001';
--> statement-breakpoint
ALTER TABLE "catalog_items" ALTER COLUMN "catalog_scope_id" SET DEFAULT 'demo-catalog-001';
--> statement-breakpoint
ALTER TABLE "catalog_stock_balances" ALTER COLUMN "catalog_scope_id" SET DEFAULT 'demo-catalog-001';
--> statement-breakpoint
ALTER TABLE "catalog_bom_components" ALTER COLUMN "catalog_scope_id" SET DEFAULT 'demo-catalog-001';
--> statement-breakpoint

ALTER TABLE "sap_materials" ADD COLUMN IF NOT EXISTS "source_scope_id" text REFERENCES "source_scopes"("id") DEFAULT 'demo-sap-001';
--> statement-breakpoint
ALTER TABLE "sap_stock_balances" ADD COLUMN IF NOT EXISTS "source_scope_id" text REFERENCES "source_scopes"("id") DEFAULT 'demo-sap-001';
--> statement-breakpoint
ALTER TABLE "normative_documents" ADD COLUMN IF NOT EXISTS "source_scope_id" text REFERENCES "source_scopes"("id") DEFAULT 'demo-normative-001';
--> statement-breakpoint
ALTER TABLE "normative_chunks" ADD COLUMN IF NOT EXISTS "source_scope_id" text REFERENCES "source_scopes"("id") DEFAULT 'demo-normative-001';
--> statement-breakpoint
ALTER TABLE "integration_states" ADD COLUMN IF NOT EXISTS "source_scope_id" text REFERENCES "source_scopes"("id") DEFAULT 'demo-system-config-001';
--> statement-breakpoint
UPDATE "sap_materials" SET "source_scope_id"='demo-sap-001' WHERE "source_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "sap_stock_balances" SET "source_scope_id"='demo-sap-001' WHERE "source_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "normative_documents" SET "source_scope_id"='demo-normative-001' WHERE "source_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "normative_chunks" SET "source_scope_id"='demo-normative-001' WHERE "source_scope_id" IS NULL;
--> statement-breakpoint
UPDATE "integration_states" SET "source_scope_id"='demo-system-config-001' WHERE "source_scope_id" IS NULL;
--> statement-breakpoint
