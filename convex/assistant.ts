import {
  createThread as createAgentThread,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { getAuthUserId } from "@convex-dev/auth/server";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { applyProposalHelper } from "./assistantData";
import { requireStaff } from "./model/access";
import { canEditSharedMenu } from "../lib/restaurant-roles";

const ASSISTANT_ROLES = ["owner", "manager"] as const;

const assistantLimiter = new RateLimiter(components.rateLimiter, {
  assistantMessage: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 10 },
  assistantUpload: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 15 },
});

async function requireAssistantStaff(ctx: QueryCtx | MutationCtx) {
  return await requireStaff(ctx, undefined, undefined, ASSISTANT_ROLES);
}

async function requireThreadOwnership(
  ctx: QueryCtx | MutationCtx,
  staff: Doc<"staff">,
  threadId: string,
) {
  const row = await ctx.db
    .query("assistantThreads")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (
    !row ||
    row.staffId !== staff._id ||
    row.organizationId !== staff.organizationId ||
    row.locationId !== staff.locationId
  ) {
    throw new ConvexError("No encontramos esa conversación del asistente.");
  }
  return row;
}

export const getAccess = query({
  args: {},
  returns: v.union(
    v.object({
      allowed: v.literal(false),
    }),
    v.object({
      allowed: v.literal(true),
      canEditMenu: v.boolean(),
      staffName: v.string(),
      locationName: v.string(),
      currencyCode: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { allowed: false as const };
    const user = await ctx.db.get("users", userId);
    const staff = user?.staffId ? await ctx.db.get("staff", user.staffId) : null;
    if (
      !staff?.isActive ||
      staff.userId !== user?._id ||
      !staff.roles.some((r) => (ASSISTANT_ROLES as readonly string[]).includes(r))
    ) {
      return { allowed: false as const };
    }
    const [org, location] = await Promise.all([
      ctx.db.get("organizations", staff.organizationId),
      ctx.db.get("locations", staff.locationId),
    ]);
    return {
      allowed: true as const,
      canEditMenu: canEditSharedMenu(staff),
      staffName: staff.displayName,
      locationName: location?.name ?? "Sucursal",
      currencyCode: org?.currencyCode ?? "MXN",
    };
  },
});

export const listThreads = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("assistantThreads"),
      threadId: v.string(),
      title: v.string(),
      contextPage: v.union(v.string(), v.null()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await requireAssistantStaff(ctx);
    const rows = await ctx.db
      .query("assistantThreads")
      .withIndex("by_staffId_and_updatedAt", (q) => q.eq("staffId", staff._id))
      .order("desc")
      .take(25);
    return rows
      .filter((row) => row.locationId === staff.locationId)
      .map((row) => ({
        _id: row._id,
        threadId: row.threadId,
        title: row.title,
        contextPage: row.contextPage ?? null,
        updatedAt: row.updatedAt,
      }));
  },
});

export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
    contextPage: v.optional(v.string()),
  },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    const staff = await requireAssistantStaff(ctx);
    const title = args.title?.trim().slice(0, 80) || "Nueva conversación";
    const threadId = await createAgentThread(ctx, components.agent, {
      userId: staff._id,
      title,
    });
    await ctx.db.insert("assistantThreads", {
      organizationId: staff.organizationId,
      locationId: staff.locationId,
      staffId: staff._id,
      threadId,
      title,
      contextPage: args.contextPage,
      updatedAt: Date.now(),
    });
    return { threadId };
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const staff = await requireAssistantStaff(ctx);
    await requireThreadOwnership(ctx, staff, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

export const listProposals = query({
  args: { threadId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("assistantProposals"),
      _creationTime: v.number(),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
      kind: v.union(
        v.literal("menu_batch"),
        v.literal("menu_edits"),
        v.literal("inventory_batch"),
        v.literal("inventory_edits"),
        v.literal("inventory_receipt"),
        v.literal("buffet_batch"),
        v.literal("floor_batch"),
        v.literal("floor_layout_changes"),
        v.literal("section_assignments"),
        v.literal("recipe_batch"),
      ),
      title: v.string(),
      summary: v.string(),
      payload: v.string(),
      resultSummary: v.union(v.string(), v.null()),
      decidedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const staff = await requireAssistantStaff(ctx);
    await requireThreadOwnership(ctx, staff, threadId);
    const rows = await ctx.db
      .query("assistantProposals")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(30);
    return rows.map((row) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      status: row.status,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      payload: row.payload,
      resultSummary: row.resultSummary ?? null,
      decidedAt: row.decidedAt ?? null,
    }));
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const staff = await requireAssistantStaff(ctx);
    await assistantLimiter.limit(ctx, "assistantUpload", { key: staff._id, throws: true });
    return await ctx.storage.generateUploadUrl();
  },
});

const attachmentValidator = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  mimeType: v.string(),
  kind: v.union(v.literal("image"), v.literal("spreadsheet"), v.literal("document")),
});

export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    contextPage: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentValidator)),
  },
  returns: v.object({ messageId: v.string() }),
  handler: async (ctx, args) => {
    const staff = await requireAssistantStaff(ctx);
    const threadRow = await requireThreadOwnership(ctx, staff, args.threadId);
    await assistantLimiter.limit(ctx, "assistantMessage", { key: staff._id, throws: true });

    const text = args.prompt.trim();
    const attachments = args.attachments ?? [];
    if (!text && attachments.length === 0) {
      throw new ConvexError("Escribe un mensaje o adjunta una imagen o archivo de Excel.");
    }
    if (attachments.length > 6) {
      throw new ConvexError("Puedes adjuntar hasta 6 archivos por mensaje.");
    }

    const fileNotes: string[] = [];
    const imageParts: Array<{ type: "image"; image: string; mediaType?: string }> = [];

    for (const att of attachments) {
      if (att.kind === "image") {
        const url = await ctx.storage.getUrl(att.storageId);
        if (url) {
          imageParts.push({
            type: "image",
            image: url,
            mediaType: att.mimeType || "image/jpeg",
          });
          fileNotes.push(
            `[Imagen adjunta: "${att.fileName}" | storageId: "${att.storageId}" — si el usuario pide usarla como foto de un platillo, pásala en photoStorageId]`,
          );
        }
      } else if (att.kind === "spreadsheet") {
        fileNotes.push(
          `[Archivo Excel/CSV adjunto: "${att.fileName}" | storageId: "${att.storageId}" — usa inspect_spreadsheet y read_spreadsheet_rows para analizarlo]`,
        );
      } else {
        fileNotes.push(
          `[Documento adjunto: "${att.fileName}" | mimeType: "${att.mimeType}" | storageId: "${att.storageId}" — usa inspect_document y read_document_chunk para leerlo]`,
        );
      }
    }

    const combinedText = [
      text || (imageParts.length > 0 ? "Analiza las imágenes adjuntas." : "Analiza el archivo adjunto."),
      ...fileNotes,
    ].join("\n\n");

    const messageContent =
      imageParts.length > 0
        ? [{ type: "text" as const, text: combinedText }, ...imageParts]
        : combinedText;

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      userId: staff._id,
      message: {
        role: "user",
        content: messageContent,
      },
    });

    // Update thread title from first user message if still default
    const nextTitle =
      threadRow.title === "Nueva conversación"
        ? (text || attachments[0]?.fileName || "Conversación").slice(0, 64)
        : threadRow.title;

    await ctx.db.patch("assistantThreads", threadRow._id, {
      title: nextTitle,
      contextPage: args.contextPage ?? threadRow.contextPage,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.assistantAgent.generateReply, {
      staffId: staff._id,
      threadId: args.threadId,
      promptMessageId: messageId,
      contextPage: args.contextPage ?? threadRow.contextPage,
    });

    return { messageId };
  },
});

export const approveProposal = mutation({
  args: { proposalId: v.id("assistantProposals") },
  returns: v.object({ resultSummary: v.string() }),
  handler: async (ctx, { proposalId }) => {
    const staff = await requireAssistantStaff(ctx);
    const proposal = await ctx.db.get("assistantProposals", proposalId);
    if (!proposal) throw new ConvexError("No encontramos esa propuesta.");
    await requireThreadOwnership(ctx, staff, proposal.threadId);

    const resultSummary = await applyProposalHelper(ctx, staff, proposal);

    await saveMessage(ctx, components.agent, {
      threadId: proposal.threadId,
      message: {
        role: "assistant",
        content: `✅ Propuesta aprobada y aplicada: **${proposal.title}**\n${resultSummary}`,
      },
    });

    return { resultSummary };
  },
});

export const rejectProposal = mutation({
  args: { proposalId: v.id("assistantProposals") },
  returns: v.null(),
  handler: async (ctx, { proposalId }) => {
    const staff = await requireAssistantStaff(ctx);
    const proposal = await ctx.db.get("assistantProposals", proposalId);
    if (!proposal) throw new ConvexError("No encontramos esa propuesta.");
    await requireThreadOwnership(ctx, staff, proposal.threadId);
    if (proposal.status !== "pending") return null;

    await ctx.db.patch("assistantProposals", proposal._id, {
      status: "rejected",
      decidedByStaffId: staff._id,
      decidedAt: Date.now(),
    });

    await saveMessage(ctx, components.agent, {
      threadId: proposal.threadId,
      message: {
        role: "assistant",
        content: `Propuesta descartada: **${proposal.title}**. Dime si quieres ajustar algo antes de intentarlo de nuevo.`,
      },
    });

    return null;
  },
});
