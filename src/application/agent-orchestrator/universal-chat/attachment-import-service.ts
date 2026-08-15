import "server-only";

import { createHash } from "node:crypto";

import type { MtrRepository } from "@/adapters/persistence/repository";
import { requirePermission } from "@/application/authorization-service";
import { validateSpecificationImport } from "@/application/specification-import";
import type { AgentExecutionContext } from "@/domain/agent/context";
import type { UniversalAgentReadPort } from "@/ports/universal-agent";
import { universalAccessScope } from "@/ports/universal-agent";

export type AgentAttachmentPurpose = "SPECIFICATION" | "SAP_IMPORT" | "REFERENCE" | "AUTO";

export interface AgentAttachmentRef {
  readonly uploadId: string;
  readonly purpose: AgentAttachmentPurpose;
}

export interface AttachmentPreviewRow {
  readonly code: string;
  readonly name: string;
  readonly quantity: number;
  readonly unit: string;
}

export interface AttachmentImportResult {
  readonly content: string;
  readonly structuredOutput: Readonly<{
    schemaVersion: "agent-attachment-import-v1";
    attachmentImport: Readonly<{
      status: "PREVIEW" | "REVIEW_REQUIRED" | "PUBLISHED";
      uploadId: string;
      fileName: string;
      parseStatus: string;
      totalRows: number;
      validRows: number;
      invalidRows: number;
      warnings: readonly string[];
      errors: readonly string[];
      previewRows: readonly AttachmentPreviewRow[];
      targetMode: "NEW" | "NEW_VERSION" | null;
      targetLabel: string | null;
      published?: Readonly<{
        specificationId: string;
        versionId: string;
        versionNumber: number;
        positionCount: number;
        href: string;
      }>;
    }>;
  }>;
}

export class AttachmentImportService {
  constructor(
    private readonly repository: Pick<
      MtrRepository,
      "getUploadedFile" | "getSpecification" | "publishSpecificationImport" | "writeAudit"
    >,
    private readonly readPort: Pick<UniversalAgentReadPort, "listProjects">,
  ) {}

  async handle(
    message: string,
    attachments: readonly AgentAttachmentRef[],
    context: AgentExecutionContext,
  ): Promise<AttachmentImportResult | null> {
    if (attachments.length === 0) return null;
    requirePermission(context.trusted, "specification.upload", {
      resourceType: "UPLOADED_FILE",
      resourceId: attachments[0]!.uploadId,
      projectId: context.trusted.activeProjectId ?? undefined,
      ownerUserId: context.trusted.subjectId,
    });

    if (attachments.length !== 1) {
      return this.clarification(
        "Чтобы исключить смешение версий, отправьте файлы спецификаций по одному.",
        attachments[0]!,
        "Несколько файлов",
      );
    }

    const attachment = attachments[0]!;
    const file = await this.repository.getUploadedFile(
      context.trusted.subjectId,
      attachment.uploadId,
    );
    if (!file || file.parseStatus === "CANCELLED") {
      return this.clarification(
        "Вложение недоступно. Загрузите файл повторно.",
        attachment,
        "Недоступный файл",
      );
    }

    if (
      file.projectId &&
      context.trusted.activeProjectId &&
      file.projectId !== context.trusted.activeProjectId
    ) {
      return this.clarification(
        "Вложение относится к другому контуру доступа.",
        attachment,
        file.originalName,
      );
    }

    const validation = file.normalizedData
      ? validateSpecificationImport(file.normalizedData)
      : emptyValidation();
    const preview = previewPayload(file, validation);
    const explicitPublish = isExplicitPublishInstruction(message);
    const specificationPurpose = attachment.purpose === "SPECIFICATION" || attachment.purpose === "AUTO";

    if (!specificationPurpose) {
      await this.auditPreview(context, file.id, attachment.purpose, validation, instructionHash(message));
      return result(
        "Файл обработан как справочное вложение. Уточните, что нужно сделать с его данными.",
        { ...preview, status: "PREVIEW", targetMode: null, targetLabel: null },
      );
    }

    if (
      file.parseStatus !== "PARSED" ||
      validation.totalRows === 0 ||
      validation.positions.length === 0 ||
      validation.errors.length > 0
    ) {
      await this.auditPreview(context, file.id, attachment.purpose, validation, instructionHash(message));
      return result(
        `Файл «${file.originalName}» требует проверки: валидных строк ${validation.validRows} из ${validation.totalRows}. Публикация не выполнялась.`,
        { ...preview, status: "REVIEW_REQUIRED", targetMode: null, targetLabel: null },
      );
    }

    const target = await this.resolveTarget(message, context);
    if (!explicitPublish || !target) {
      await this.auditPreview(context, file.id, attachment.purpose, validation, instructionHash(message));
      const targetText = target
        ? `Предполагаемое действие: ${target.label}.`
        : "Не удалось однозначно определить новую спецификацию или целевую текущую версию.";
      return result(
        `Распознано ${validation.validRows} позиций без блокирующих ошибок. ${targetText} Выберите: создать новую спецификацию, новую версию или отменить загрузку.`,
        {
          ...preview,
          status: "PREVIEW",
          targetMode: target?.mode ?? null,
          targetLabel: target?.label ?? null,
        },
      );
    }

    requirePermission(context.trusted, "specification.publish", {
      resourceType: "SPECIFICATION",
      resourceId: target.mode === "NEW_VERSION" ? target.specificationId : file.id,
      projectId: context.trusted.activeProjectId ?? undefined,
    });
    const hash = instructionHash(message);
    const published = await this.repository.publishSpecificationImport(context.trusted.subjectId, {
      fileId: file.id,
      projectId: context.trusted.activeProjectId ?? undefined,
      mode: target.mode,
      ...(target.mode === "NEW"
        ? { projectCode: target.projectCode, name: target.name }
        : { specificationId: target.specificationId }),
      positions: validation.positions,
      validationSummary: {
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows,
        warningCount: validation.warnings.length,
        instructionHash: hash,
      },
      instructionHash: hash,
    });
    return result(
      `Опубликована спецификация «${published.specification.name}», версия ${published.version.versionNumber}. Сохранено ${published.version.positionCount} позиций.`,
      {
        ...preview,
        status: "PUBLISHED",
        targetMode: target.mode,
        targetLabel: target.label,
        published: {
          specificationId: published.specification.id,
          versionId: published.version.id,
          versionNumber: published.version.versionNumber,
          positionCount: published.version.positionCount,
          href: `/specifications/${encodeURIComponent(published.specification.id)}`,
        },
      },
    );
  }

  private async resolveTarget(message: string, context: AgentExecutionContext): Promise<ImportTarget | null> {
    const existingId = context.selection.specificationId;
    const asksForNewSpecification = /нов(?:ую|ая|ой)\s+спецификац/iu.test(message);
    if (existingId && !asksForNewSpecification) {
      const specification = await this.repository.getSpecification(context.trusted.subjectId, existingId);
      if (
        specification &&
        (!specification.projectId || specification.projectId === context.trusted.activeProjectId)
      ) {
        return {
          mode: "NEW_VERSION",
          specificationId: specification.id,
          label: `новая версия «${specification.name}»`,
        };
      }
    }

    if (!asksForNewSpecification) return null;
    const requestedCode = message.match(/\bPRJ-\d{3}\b/iu)?.[0]?.toLocaleUpperCase("ru-RU");
    const requestedName = message.match(/спецификац(?:ию|ия|ии)\s+[«"]([^»"]{1,300})[»"]/iu)?.[1]?.trim();
    if (!requestedCode || !requestedName) return null;
    const projects = await this.readPort.listProjects(
      context,
      universalAccessScope(context),
      { limit: 200 },
    );
    const project = projects.find((candidate) => candidate.code.toLocaleUpperCase("ru-RU") === requestedCode);
    if (!project) return null;
    return {
      mode: "NEW",
      projectCode: project.code,
      name: requestedName,
      label: `новая спецификация «${requestedName}» проекта ${project.code}`,
    };
  }

  private async auditPreview(
    context: AgentExecutionContext,
    fileId: string,
    purpose: AgentAttachmentPurpose,
    validation: ReturnType<typeof validateSpecificationImport>,
    hash: string,
  ): Promise<void> {
    await this.repository.writeAudit(context.trusted.subjectId, {
      actorDisplayName: context.trusted.displayName,
      action: "agent.attachment.previewed",
      entityType: "UPLOADED_FILE",
      entityId: fileId,
      outcome: validation.errors.length > 0 ? "REVIEW_REQUIRED" : "SUCCESS",
      details: {
        purpose,
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows,
        instructionHash: hash,
        authorizationVersion: context.trusted.authorizationVersion,
      },
      requestId: context.correlationId,
    });
  }

  private clarification(content: string, attachment: AgentAttachmentRef, fileName: string): AttachmentImportResult {
    return result(content, {
      status: "REVIEW_REQUIRED",
      uploadId: attachment.uploadId,
      fileName,
      parseStatus: "UNAVAILABLE",
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      warnings: [],
      errors: [content],
      previewRows: [],
      targetMode: null,
      targetLabel: null,
    });
  }
}

type ImportTarget =
  | Readonly<{ mode: "NEW"; projectCode: string; name: string; label: string }>
  | Readonly<{ mode: "NEW_VERSION"; specificationId: string; label: string }>;

function previewPayload(
  file: Readonly<{ id: string; originalName: string; parseStatus: string }>,
  validation: ReturnType<typeof validateSpecificationImport>,
) {
  return {
    uploadId: file.id,
    fileName: file.originalName,
    parseStatus: file.parseStatus,
    totalRows: validation.totalRows,
    validRows: validation.validRows,
    invalidRows: validation.invalidRows,
    warnings: validation.warnings.slice(0, 20),
    errors: validation.errors.slice(0, 20).map((item) =>
      item.row > 0 ? `Строка ${item.row}: ${item.message}` : item.message),
    previewRows: validation.positions.slice(0, 20).map((position) => ({
      code: position.internalCode,
      name: position.nameRu,
      quantity: position.requiredQuantity,
      unit: position.unit,
    })),
  } as const;
}

function result(
  content: string,
  attachmentImport: AttachmentImportResult["structuredOutput"]["attachmentImport"],
): AttachmentImportResult {
  return {
    content,
    structuredOutput: {
      schemaVersion: "agent-attachment-import-v1",
      attachmentImport,
    },
  };
}

function emptyValidation(): ReturnType<typeof validateSpecificationImport> {
  return { positions: [], errors: [], warnings: [], totalRows: 0, validRows: 0, invalidRows: 0 };
}

function isExplicitPublishInstruction(message: string): boolean {
  return /(?:загрузи|загрузить|опубликуй|опубликовать|сохрани\s+(?:эту|как))/iu.test(message);
}

function instructionHash(message: string): string {
  return createHash("sha256").update(message.normalize("NFKC").trim(), "utf8").digest("hex");
}
