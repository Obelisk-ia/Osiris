import { Agent, createTool, saveMessage, stepCountIs } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction } from "./_generated/server";
import {
  buffetBatchProposalSchema,
  floorBatchProposalSchema,
  floorLayoutChangesProposalSchema,
  inventoryBatchProposalSchema,
  inventoryEditsProposalSchema,
  inventoryReceiptProposalSchema,
  menuBatchProposalSchema,
  menuEditsProposalSchema,
  recipeBatchProposalSchema,
  sectionAssignmentsProposalSchema,
  TABLE_SHAPE_VALUES,
} from "../lib/assistant-proposals";

const DEFAULT_OPENROUTER_MODEL = "tencent/hy4-flash";

// Static prefix kept strictly constant at the top of the system prompt to
// maximize OpenRouter / provider KV prompt-cache hits across turns and tool calls.
const STATIC_SYSTEM_PREFIX = `Eres el Asistente de Operaciones de Osiris para dueños y gerentes de restaurante.

REGLAS ESTRICTAS DE SEGURIDAD:
1. NUNCA puedes eliminar, archivar, anular ni sobrescribir registros destructivamente.
2. Responde siempre en español claro, directo y práctico para operación de restaurante.

CUÁNDO EJECUTAR DIRECTO VS PROPONER CON CONFIRMACIÓN HUMANA:
- Consultas (ver menú, revisar stock bajo, distribución de mesas, menús de buffet): usa las herramientas de lectura y responde con datos reales.
- Creaciones pequeñas y aditivas (1 sección, 1 tipo de mesa, hasta 6 mesas, 1-3 proveedores, 1 categoría, 1 menú de buffet con platillos existentes): puedes usar las herramientas \`create_*\` directamente.
- Cargas masivas o desde archivos/fotos/documentos (menú completo desde fotos o PDF, recetas e ingredientes, inventario desde Excel/CSV, planos con muchas mesas/secciones, configuración completa de buffet): SIEMPRE usa \`propose_menu_batch\`, \`propose_recipe_batch\`, \`propose_inventory_batch\`, \`propose_buffet_batch\` o \`propose_floor_batch\`.
- EDITAR REGISTROS EXISTENTES (platillos, fotos de platillos, inventario, secciones o composición/posición de mesas): SIEMPRE requiere confirmación humana previa.
  - Para editar platillos existentes (precio, descripción, categoría, áreas, disponibilidad, modificadores o asignar una foto subida usando su \`photoStorageId\`): usa \`propose_menu_edits\`.
  - Para editar insumos existentes (costo unitario, mínimo/máximo, proveedor, categoría o presentación): usa \`propose_inventory_edits\`.
  - Para mover, redimensionar, renombrar secciones existentes o editar/mover mesas existentes (posición, sección destino, número de asientos, forma \`round|square|rectangle|oval\`, tipo de mesa o nombre): primero llama \`get_floor_distribution\` y luego usa \`propose_floor_layout_changes\`. Nunca afirmes que los cambios ya se aplicaron hasta que el usuario apruebe la tarjeta.

ARCHIVOS EXCEL / CSV DE INVENTARIO:
- Cuando el usuario adjunte un archivo Excel o CSV, primero llama \`inspect_spreadsheet\` con su \`storageId\` para entender su estructura real (puede tener varias hojas, encabezados en filas intermedias, columnas en español o inglés, unidades variadas como kg, g, L, ml, pzas, cajas, etc.).
- Luego lee las filas necesarias con \`read_spreadsheet_rows\` (pagina si hay más de 100 filas).
- Mapea con criterio flexible cada fila a \`propose_inventory_batch\`. El sistema convertirá automáticamente las unidades a micros y los precios a centavos.

DOCUMENTOS PDF, TXT, MARKDOWN O JSON (RECETAS, MENÚS, LISTAS):
- Cuando el usuario adjunte un PDF, TXT, MD o JSON, llama \`inspect_document\` con su \`storageId\`, \`fileName\` y \`mimeType\`. Si \`hasMore\` es true, continúa leyendo con \`read_document_chunk\`.
- Si el documento contiene recetas con ingredientes y cantidades por platillo:
  1. Revisa \`list_menu\` y \`list_inventory\` para conocer los platillos e insumos ya existentes.
  2. Si los platillos ya existen y solo faltan sus recetas, usa \`propose_recipe_batch\`. Si además hay platillos nuevos por crear, usa \`propose_menu_batch\` incluyendo \`ingredients\` con \`inventoryQuantity\` e \`inventoryUnit\`.
  3. IMPORTANTE: Si algún ingrediente de la receta NO existe todavía en el inventario actual, el sistema creará automáticamente ese insumo con una pequeña muestra de stock inicial al aprobar la propuesta. Avísale claramente al usuario en el resumen cuáles ingredientes faltan en inventario y se crearán como muestra inicial para que después ajuste existencias y costos reales.

FOTOS DE MENÚ, FACTURAS / TICKETS DE PROVEEDOR O PLANOS:
- Si el usuario sube fotos de su menú físico o digital, extrae cuidadosamente categorías, nombres, descripciones, precios (en la moneda del restaurante, no centavos), áreas de preparación (\`kitchen\`, \`bar\`, \`cocktails\`, \`coffee\`), modificadores e ingredientes visibles, y llama \`propose_menu_batch\`.
- Si el usuario sube una foto o PDF de una **factura, ticket o nota de remisión de compra**: extrae folio/referencia, proveedor, artículos recibidos, cantidades, unidades y costos unitarios, consulta \`list_inventory\` para emparejar nombres existentes, y llama \`propose_inventory_receipt\` para registrar la entrada de stock y actualizar los costos con confirmación humana.
- Si el usuario pregunta por **márgenes, costos de receta o rentabilidad de platillos**, llama \`get_menu_margins\` y responde con cifras claras (costo, utilidad bruta, margen %, food cost % y alertas si algún ingrediente no tiene costo).
- Si el usuario pregunta por **ventas, métodos de pago, propinas, cortes de caja, platillos más vendidos o cancelaciones**, llama \`get_sales_and_shift_summary\`.
- Si el usuario pide **asignar meseros a secciones** del turno, consulta \`get_floor_distribution\` (que incluye meseros activos, asientos por sección y asignaciones actuales) y usa \`propose_section_assignments\` con confirmación humana.`;

function buildSystemInstructions(opts: {
  restaurantName: string;
  locationName: string;
  currencyCode: string;
  serviceMode: string;
  timeZone: string;
  staffName: string;
  canEditMenu: boolean;
  contextPage?: string;
}) {
  const menuRule = opts.canEditMenu
    ? "Permiso de menú: HABILITADO (puedes proponer categorías, platillos, modificadores y recetas)."
    : "Permiso de menú: RESTRINGIDO (esta cuenta de gerente NO tiene permiso edit_menu; puedes consultar menú y gestionar mesas, inventario, proveedores y buffet con platillos existentes, pero NO crear platillos, categorías ni editar recetas).";

  return `${STATIC_SYSTEM_PREFIX}

CONTEXTO DE ESTA SUCURSAL:
- Restaurante: "${opts.restaurantName}" | Sucursal: "${opts.locationName}"
- Moneda: ${opts.currencyCode} | Modo de servicio: "${opts.serviceMode}" | Zona horaria: ${opts.timeZone}
- Usuario: ${opts.staffName}
- ${menuRule}
- Pantalla actual: ${opts.contextPage ?? "general"}`;
}

function createToolsForStaff(staffId: Id<"staff">, threadId: string, canEditMenu: boolean) {
  const baseTools = {
    get_restaurant_context: createTool({
      description: "Obtiene información general del restaurante, sucursal, moneda, modo de servicio y áreas habilitadas.",
      inputSchema: z.object({}),
      execute: async (ctx) => {
        return await ctx.runQuery(internal.assistantData.getRestaurantContext, { staffId });
      },
    }),

    list_menu: createTool({
      description: "Consulta categorías, platillos, precios, áreas, modificadores y estaciones de preparación del menú actual.",
      inputSchema: z.object({
        categoryFilter: z.string().optional().describe("Filtra opcionalmente por nombre de categoría"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runQuery(internal.assistantData.listMenu, {
          staffId,
          categoryFilter: input.categoryFilter,
        });
      },
    }),

    list_inventory: createTool({
      description: "Consulta insumos de inventario, existencias actuales, mínimos, costos, estado (normal/low/out/negative) y proveedores.",
      inputSchema: z.object({
        onlyLowStock: z.boolean().optional().describe("Si es true, devuelve solo insumos bajos, agotados o en negativo"),
        search: z.string().optional().describe("Búsqueda por nombre o categoría de insumo"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runQuery(internal.assistantData.listInventory, {
          staffId,
          onlyLowStock: input.onlyLowStock,
          search: input.search,
        });
      },
    }),

    get_floor_distribution: createTool({
      description: "Consulta la distribución actual de mesas: secciones, dimensiones de lienzo, tipos de mesa, mesas activas, asientos, coordenadas y estado.",
      inputSchema: z.object({}),
      execute: async (ctx) => {
        return await ctx.runQuery(internal.assistantData.getFloorDistribution, { staffId });
      },
    }),

    list_buffet_menus: createTool({
      description: "Consulta la configuración de buffet de la sucursal y los menús de buffet programados por fecha con sus platillos.",
      inputSchema: z.object({}),
      execute: async (ctx) => {
        return await ctx.runQuery(internal.assistantData.listBuffetMenus, { staffId });
      },
    }),

    get_menu_margins: createTool({
      description: "Calcula el costo de receta, utilidad bruta, margen % y food cost % de los platillos del menú usando recipeIngredients y lastCostCents del inventario. Señala platillos sin receta o ingredientes sin costo.",
      inputSchema: z.object({
        maxMarginPct: z.number().min(0).max(100).optional().describe("Filtra opcionalmente platillos con margen menor o igual a este porcentaje"),
        categoryFilter: z.string().optional().describe("Filtra opcionalmente por categoría de menú"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runQuery(internal.assistantData.getMenuMargins, {
          staffId,
          maxMarginPct: input.maxMarginPct,
          categoryFilter: input.categoryFilter,
        });
      },
    }),

    get_sales_and_shift_summary: createTool({
      description: "Consulta resumen de ventas por método de pago, propinas, cortes/turnos de caja (con diferencias esperado vs contado), platillos más vendidos y cancelaciones de los últimos N días (1 a 30).",
      inputSchema: z.object({
        daysBack: z.number().int().min(1).max(30).default(1).describe("Cantidad de días hacia atrás a analizar (1 = últimas 24h, 7 = última semana, hasta 30)"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runQuery(internal.assistantData.getSalesAndShiftSummary, {
          staffId,
          daysBack: input.daysBack,
        });
      },
    }),

    inspect_spreadsheet: createTool({
      description: "Inspecciona un archivo Excel (.xlsx/.xls) o CSV subido al chat. Devuelve nombres de hojas, total de filas y las primeras 20 filas con letras de columna (A, B, C...) para entender cualquier estructura.",
      inputSchema: z.object({
        storageId: z.string().describe("El storageId del archivo adjunto"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runAction(internal.assistantExcel.inspectWorkbook, {
          storageId: input.storageId as Id<"_storage">,
        });
      },
    }),

    read_spreadsheet_rows: createTool({
      description: "Lee un rango de filas de una hoja de un archivo Excel/CSV previamente inspeccionado. Úsalo para leer todos los registros en páginas de hasta 150 filas.",
      inputSchema: z.object({
        storageId: z.string().describe("El storageId del archivo adjunto"),
        sheetName: z.string().optional().describe("Nombre exacto de la hoja a leer (por defecto la primera)"),
        startRow: z.number().int().min(1).default(1).describe("Número de fila inicial (empieza en 1)"),
        limit: z.number().int().min(1).max(150).default(100).describe("Cantidad de filas a leer"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runAction(internal.assistantExcel.readSheetRows, {
          storageId: input.storageId as Id<"_storage">,
          sheetName: input.sheetName,
          startRow: input.startRow,
          limit: input.limit,
        });
      },
    }),

    inspect_document: createTool({
      description: "Inspecciona un documento PDF, TXT, Markdown o JSON adjunto al chat (recetas, menús, listas). Devuelve formato, número de páginas, longitud y una vista previa de hasta 4,000 caracteres.",
      inputSchema: z.object({
        storageId: z.string().describe("El storageId del documento adjunto"),
        fileName: z.string().optional().describe("Nombre del archivo para detectar formato"),
        mimeType: z.string().optional().describe("Tipo MIME del documento"),
      }),
      execute: async (ctx, input) => {
        return await ctx.runAction(internal.assistantDocs.inspectDocument, {
          storageId: input.storageId as Id<"_storage">,
          fileName: input.fileName,
          mimeType: input.mimeType,
        });
      },
    }),

    read_document_chunk: createTool({
      description: "Lee el siguiente bloque de texto de un documento PDF/TXT/MD/JSON grande a partir de startChar.",
      inputSchema: z.object({
        storageId: z.string().describe("El storageId del documento adjunto"),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        startChar: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(500).max(12000).default(8000),
      }),
      execute: async (ctx, input) => {
        return await ctx.runAction(internal.assistantDocs.readDocumentChunk, {
          storageId: input.storageId as Id<"_storage">,
          fileName: input.fileName,
          mimeType: input.mimeType,
          startChar: input.startChar,
          maxChars: input.maxChars,
        });
      },
    }),

    create_section: createTool({
      description: "Crea una nueva sección en el plano de mesas (ej. Terraza, Salón Principal, Barra). No sobrescribe si ya existe.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(200).optional(),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createSectionDirect, {
          staffId,
          name: input.name,
          description: input.description,
        });
      },
    }),

    create_table_type: createTool({
      description: "Crea un nuevo tipo de mesa reutilizable (forma y número de asientos).",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        shape: z.enum(TABLE_SHAPE_VALUES).default("square"),
        seatCount: z.number().int().min(1).max(30).default(4),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createTableTypeDirect, {
          staffId,
          name: input.name,
          shape: input.shape,
          seatCount: input.seatCount,
        });
      },
    }),

    create_tables: createTool({
      description: "Crea entre 1 y 10 mesas en una sección (crea la sección si no existe) ubicándolas automáticamente sin encimarlas. Para más de 10 mesas usa propose_floor_batch.",
      inputSchema: z.object({
        sectionName: z.string().min(1).max(80),
        tables: z
          .array(
            z.object({
              tableNumber: z.string().min(1).max(40),
              seatCount: z.number().int().min(1).max(30).default(4),
              shape: z.enum(TABLE_SHAPE_VALUES).default("square"),
              tableTypeName: z.string().max(80).optional(),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createTablesDirect, {
          staffId,
          sectionName: input.sectionName,
          tables: input.tables,
        });
      },
    }),

    create_suppliers: createTool({
      description: "Crea uno o varios proveedores nuevos (omite duplicados existentes).",
      inputSchema: z.object({
        suppliers: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              contact: z.string().max(150).optional(),
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createSuppliersDirect, {
          staffId,
          suppliers: input.suppliers,
        });
      },
    }),

    create_buffet_menu: createTool({
      description: "Crea un menú de buffet para una fecha específica (AAAA-MM-DD) asociando platillos ya existentes por nombre.",
      inputSchema: z.object({
        name: z.string().min(1).max(100),
        menuDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dishNames: z.array(z.string().min(1)).min(1),
        destination: z.string().max(80).optional(),
        portionsPerTray: z.number().int().min(1).optional(),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createBuffetMenuDirect, {
          staffId,
          ...input,
        });
      },
    }),

    propose_inventory_batch: createTool({
      description: "Genera una propuesta de importación masiva de proveedores e insumos de inventario (ideal tras leer Excel/CSV) para que el usuario revise y confirme con 1 clic.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        batch: inventoryBatchProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "inventory_batch",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.batch),
        });
      },
    }),

    propose_buffet_batch: createTool({
      description: "Genera una propuesta para configurar uno o varios menús de buffet con sus platillos, destinos y porciones por charola para confirmación con 1 clic.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        batch: buffetBatchProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "buffet_batch",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.batch),
        });
      },
    }),

    propose_floor_batch: createTool({
      description: "Genera una propuesta para crear múltiples secciones, tipos de mesa y mesas en lote con confirmación de 1 clic.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        batch: floorBatchProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "floor_batch",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.batch),
        });
      },
    }),

    propose_floor_layout_changes: createTool({
      description: "Propone editar o reacomodar secciones existentes (posición, tamaño, nombre, descripción) y/o mesas existentes (posición, sección destino, asientos, forma, tipo o nombre). SIEMPRE requiere confirmación humana antes de aplicarse.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        changes: floorLayoutChangesProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "floor_layout_changes",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.changes),
        });
      },
    }),

    propose_inventory_edits: createTool({
      description: "Propone editar insumos existentes en inventario (costo unitario, mínimo, máximo, proveedor, categoría, presentación o nombre) con confirmación humana.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        edits: inventoryEditsProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "inventory_edits",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.edits),
        });
      },
    }),

    propose_inventory_receipt: createTool({
      description: "Propone registrar una entrada de inventario + actualización de costos a partir de una factura, ticket o nota de remisión (foto, PDF o texto) con confirmación humana.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        receipt: inventoryReceiptProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "inventory_receipt",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.receipt),
        });
      },
    }),

    propose_section_assignments: createTool({
      description: "Propone asignar meseros activos a secciones del plano para el turno actual con confirmación humana.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        plan: sectionAssignmentsProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "section_assignments",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.plan),
        });
      },
    }),
  };

  if (!canEditMenu) {
    return baseTools;
  }

  return {
    ...baseTools,
    create_dish_category: createTool({
      description: "Crea una categoría de platillos nueva en el menú.",
      inputSchema: z.object({
        name: z.string().min(1).max(80),
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createDishCategoryDirect, {
          staffId,
          name: input.name,
        });
      },
    }),

    propose_menu_batch: createTool({
      description: "Genera una propuesta de creación en lote de categorías, platillos, precios, áreas, modificadores e ingredientes (ideal tras analizar fotos/PDFs de menú) para que el usuario revise y confirme con 1 clic. Los ingredientes con inventoryQuantity/inventoryUnit que no existan en inventario se crearán automáticamente con una pequeña muestra inicial.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        batch: menuBatchProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "menu_batch",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.batch),
        });
      },
    }),

    propose_menu_edits: createTool({
      description: "Propone editar platillos existentes del menú (precio, descripción, categoría, áreas, disponibilidad, modificadores o asignar una foto subida usando photoStorageId) con confirmación humana.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        edits: menuEditsProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "menu_edits",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.edits),
        });
      },
    }),

    propose_recipe_batch: createTool({
      description: "Propone vincular recetas (ingredientes y cantidades exactas) a platillos existentes del menú con confirmación humana. Si algún ingrediente no existe en inventario, el sistema creará automáticamente el insumo con una pequeña muestra de stock inicial y avisará al usuario.",
      inputSchema: z.object({
        title: z.string().min(1).max(140),
        summary: z.string().min(1).max(400),
        batch: recipeBatchProposalSchema,
      }),
      execute: async (ctx, input) => {
        return await ctx.runMutation(internal.assistantData.createProposal, {
          staffId,
          threadId,
          kind: "recipe_batch",
          title: input.title,
          summary: input.summary,
          payload: JSON.stringify(input.batch),
        });
      },
    }),
  };
}

export const generateReply = internalAction({
  args: {
    staffId: v.id("staff"),
    threadId: v.string(),
    promptMessageId: v.string(),
    contextPage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.assistantData.getRestaurantContext, {
      staffId: args.staffId,
    });

    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content:
            "Falta configurar `OPENROUTER_API_KEY` en el entorno de Convex. Ejecuta `npx convex env set OPENROUTER_API_KEY <tu_clave>` (o agrégala en el dashboard de Convex) y vuelve a intentarlo.",
        },
      });
      return;
    }

    const modelId = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    const openrouter = createOpenRouter({
      apiKey,
      headers: {
        "HTTP-Referer": "https://osiris.app",
        "X-Title": "Osiris Restaurant Assistant",
      },
    });

    const languageModel = openrouter.chat(modelId, {
      reasoning: { effort: "low", exclude: true },
      usage: { include: true },
      ...(modelId.startsWith("anthropic/")
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    });

    const tools = createToolsForStaff(args.staffId, args.threadId, context.canEditMenu);

    const agent = new Agent(components.agent, {
      name: "Asistente Osiris",
      languageModel,
      instructions: buildSystemInstructions({
        ...context,
        contextPage: args.contextPage,
      }),
      tools,
      stopWhen: stepCountIs(12),
      usageHandler: async (_ctx, info) => {
        const cached = info.usage.inputTokenDetails?.cacheReadTokens ?? 0;
        const inputTokens = info.usage.inputTokens ?? 0;
        const outputTokens = info.usage.outputTokens ?? 0;
        const hitPct = inputTokens > 0 ? Math.round((cached / inputTokens) * 100) : 0;
        console.info(
          `[assistant-usage] model=${info.model} in=${inputTokens} cached=${cached} (${hitPct}%) out=${outputTokens}`,
        );
      },
    });

    try {
      await agent.streamText(
        ctx,
        { threadId: args.threadId },
        { promptMessageId: args.promptMessageId },
        {
          saveStreamDeltas: { chunking: "word", throttleMs: 150 },
        },
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Error inesperado al consultar el modelo.";
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content: `No pude completar la respuesta con OpenRouter (${modelId}). Detalle: ${detail}`,
        },
      });
    }
  },
});
