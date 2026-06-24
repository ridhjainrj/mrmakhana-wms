import { NextResponse } from "next/server";

type SupabaseRow = Record<string, unknown>;

const roleCredentials: Record<string, { email: string; password: string }> = {
  Admin: { email: "admin@mrmakhana.test", password: "Admin@123" },
  Accountant: { email: "accountant@mrmakhana.test", password: "Account@123" },
  "Warehouse Manager": { email: "manager@mrmakhana.test", password: "Manager@123" },
  Operator: { email: "operator@mrmakhana.test", password: "Operator@123" },
  Viewer: { email: "viewer@mrmakhana.test", password: "Viewer@123" },
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase environment variables are missing.");
  return { url, serviceKey };
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { url, serviceKey } = getSupabaseConfig();
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${path} failed with ${response.status}: ${message}`);
  }
  return response;
}

async function selectRows(table: string, order = "created_at.desc") {
  const response = await supabaseFetch(`/rest/v1/${table}?select=*&order=${order}`, {
    headers: { Prefer: "count=exact" },
  });
  return (await response.json()) as SupabaseRow[];
}

async function upsertRows(table: string, rows: SupabaseRow[], conflict = "id") {
  if (!rows.length) return;
  await supabaseFetch(`/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

async function deleteMissingRows(table: string, keepIds: string[]) {
  const filter = keepIds.length ? `?id=not.in.(${keepIds.map(encodeURIComponent).join(",")})` : "";
  await supabaseFetch(`/rest/v1/${table}${filter}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

function asNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function warehouseNameToStableId(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("factory")) return "factory";
  if (lower.includes("delhi")) return "delhi";
  if (lower.includes("mumbai")) return "mumbai";
  if (lower.includes("transit")) return "transit";
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function dbToApp({
  settings,
  warehouses,
  profiles,
  products,
  cartons,
  sessions,
  documents,
  mismatches,
  audit,
}: Record<string, SupabaseRow[]>) {
  const warehouseAliasByDbId = Object.fromEntries(
    warehouses.map((item) => [String(item.id), warehouseNameToStableId(String(item.name))]),
  );
  const dbIdByWarehouseAlias = Object.fromEntries(
    warehouses.map((item) => [warehouseNameToStableId(String(item.name)), String(item.id)]),
  );
  const settingsByKey = Object.fromEntries(settings.map((item) => [String(item.key), item.value as Record<string, unknown>]));
  const appMode = settingsByKey.app_mode ?? {};

  return {
    settings: {
      mode: appMode.mode === "production" ? "production" : "development",
      goLiveAt: typeof appMode.go_live_at === "string" ? appMode.go_live_at : undefined,
      supabaseProjectRef: typeof settingsByKey.supabase_project_ref?.project_ref === "string" ? settingsByKey.supabase_project_ref.project_ref : undefined,
    },
    users: profiles.map((item) => {
      const role = String(item.role);
      const credentials = roleCredentials[role] ?? { email: `${role.toLowerCase().replaceAll(" ", ".")}@mrmakhana.test`, password: "Password@123" };
      return {
        id: String(item.id),
        name: String(item.full_name),
        email: credentials.email,
        password: credentials.password,
        role,
        warehouseId: warehouseAliasByDbId[String(item.warehouse_id)] ?? "factory",
      };
    }),
    warehouses: warehouses.map((item) => ({
      id: warehouseNameToStableId(String(item.name)),
      dbId: String(item.id),
      name: String(item.name),
      type: item.type,
    })),
    products: products.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      category: String(item.category),
      sku: String(item.sku),
      gtin: String(item.gtin),
      prefix: String(item.prefix),
      flavour: String(item.flavour),
      weight: String(item.weight),
      mrp: asNumber(item.mrp),
      caseQty: asNumber(item.case_qty),
      qtyUnit: item.qty_unit,
      variantCode: String(item.variant_code),
      shelfLifeDays: asNumber(item.shelf_life_days),
      hsn: item.hsn ? String(item.hsn) : undefined,
      status: item.status,
      template: String(item.barcode_template),
      dataOrigin: item.data_origin,
      archived: Boolean(item.archived),
    })),
    cartons: cartons.map((item) => ({
      id: String(item.id),
      barcode: String(item.barcode_value),
      productId: String(item.product_id),
      sku: String(item.sku),
      gtin: String(item.gtin),
      flavour: String(item.flavour),
      weight: String(item.weight),
      mrp: asNumber(item.mrp),
      qty: asNumber(item.carton_quantity),
      qtyUnit: String(item.qty_unit),
      batch: String(item.batch),
      mfd: String(item.mfd),
      expiry: String(item.expiry),
      cartonNo: String(item.carton_no),
      warehouseId: warehouseAliasByDbId[String(item.current_warehouse_id)] ?? "factory",
      status: item.current_status,
      customer: item.customer ? String(item.customer) : undefined,
      blockedReason: item.blocked_reason ? String(item.blocked_reason) : undefined,
      dataOrigin: item.data_origin,
      archived: Boolean(item.archived),
    })),
    sessions: sessions.map((item) => ({
      id: String(item.id),
      type: item.session_type,
      sourceWarehouseId: warehouseAliasByDbId[String(item.source_warehouse_id)] ?? "factory",
      destinationWarehouseId: item.destination_warehouse_id ? warehouseAliasByDbId[String(item.destination_warehouse_id)] : undefined,
      sourceSessionId: item.source_session_id ? String(item.source_session_id) : undefined,
      customer: item.customer ? String(item.customer) : undefined,
      vehicle: item.vehicle_number ? String(item.vehicle_number) : undefined,
      driver: item.driver_name ? String(item.driver_name) : undefined,
      lr: item.lr_docket ? String(item.lr_docket) : undefined,
      transporter: item.transporter ? String(item.transporter) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      createdBy: String(item.created_by),
      createdAt: String(item.created_at),
      updatedAt: String(item.updated_at),
      scanned: Array.isArray(item.scanned_barcodes) ? item.scanned_barcodes : [],
      expected: Array.isArray(item.expected_barcodes) ? item.expected_barcodes : [],
      finalized: Boolean(item.finalized),
      dataOrigin: item.data_origin,
      archived: Boolean(item.archived),
    })),
    documents: documents.map((item) => ({
      id: String(item.id),
      type: String(item.document_type),
      createdAt: String(item.created_at),
      createdBy: item.created_by ? String(item.created_by) : "System",
      approver: item.approver ? String(item.approver) : undefined,
      source: item.source ? String(item.source) : undefined,
      destination: item.destination ? String(item.destination) : undefined,
      vehicle: item.vehicle_number ? String(item.vehicle_number) : undefined,
      driver: item.driver_name ? String(item.driver_name) : undefined,
      lr: item.lr_docket ? String(item.lr_docket) : undefined,
      transporter: item.transporter ? String(item.transporter) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      discrepancy: item.discrepancy ? String(item.discrepancy) : undefined,
      barcodes: Array.isArray(item.barcode_values) ? item.barcode_values : [],
      dataOrigin: item.data_origin,
      archived: Boolean(item.archived),
    })),
    mismatches: mismatches.map((item) => ({
      id: String(item.id),
      sessionId: item.session_id ? String(item.session_id) : "",
      status: item.status,
      createdAt: String(item.created_at),
      missing: Array.isArray(item.missing_barcodes) ? item.missing_barcodes : [],
      extra: Array.isArray(item.extra_barcodes) ? item.extra_barcodes : [],
      duplicates: Array.isArray(item.duplicate_barcodes) ? item.duplicate_barcodes : [],
      approvedBy: item.approved_by ? String(item.approved_by) : undefined,
      reason: item.reason ? String(item.reason) : undefined,
      dataOrigin: item.data_origin,
      archived: Boolean(item.archived),
    })),
    audit: audit.map((item) => ({
      id: String(item.id),
      time: String(item.created_at),
      userId: item.user_id ? String(item.user_id) : "",
      role: item.role,
      action: String(item.action),
      barcode: item.barcode_value ? String(item.barcode_value) : undefined,
      documentRef: item.document_ref ? String(item.document_ref) : undefined,
      oldValue: item.old_value == null ? undefined : String(item.old_value).replace(/^"|"$/g, ""),
      newValue: item.new_value == null ? undefined : String(item.new_value).replace(/^"|"$/g, ""),
      reason: item.reason ? String(item.reason) : undefined,
    })),
    registry: [],
    dbIdByWarehouseAlias,
  };
}

function appToDb(state: Record<string, unknown>) {
  const warehouses = (state.warehouses as Record<string, unknown>[]) ?? [];
  const userIds = new Set(((state.users as Record<string, unknown>[]) ?? []).map((item) => String(item.id)));
  const validUserId = (value: unknown) => (isUuid(value) && userIds.has(String(value)) ? value : null);
  const warehouseDbId = Object.fromEntries(warehouses.map((item) => [String(item.id), String(item.dbId ?? item.id)]));
  const settings = state.settings as Record<string, unknown>;

  return {
    settings: [
      { key: "app_mode", value: { mode: settings.mode, phase: "uat", go_live_at: settings.goLiveAt ?? null } },
      { key: "supabase_project_ref", value: { project_ref: settings.supabaseProjectRef ?? "yagdnrnfqbqcqgcbejuc" } },
    ],
    products: ((state.products as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      flavour: item.flavour,
      category: item.category,
      sku: item.sku,
      gtin: item.gtin,
      prefix: item.prefix,
      weight: item.weight,
      mrp: item.mrp,
      case_qty: item.caseQty,
      qty_unit: item.qtyUnit,
      variant_code: item.variantCode,
      shelf_life_days: item.shelfLifeDays,
      hsn: item.hsn || null,
      status: item.status,
      barcode_template: item.template,
      data_origin: item.dataOrigin ?? "real",
      archived: Boolean(item.archived),
    })),
    cartons: ((state.cartons as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      barcode_value: item.barcode,
      product_id: item.productId,
      sku: item.sku,
      gtin: item.gtin,
      flavour: item.flavour,
      weight: item.weight,
      mrp: item.mrp,
      carton_quantity: item.qty,
      qty_unit: item.qtyUnit,
      batch: item.batch,
      mfd: item.mfd,
      expiry: item.expiry,
      carton_no: item.cartonNo,
      current_warehouse_id: warehouseDbId[String(item.warehouseId)] ?? warehouseDbId.factory,
      current_status: item.status,
      customer: item.customer || null,
      blocked_reason: item.blockedReason || null,
      data_origin: item.dataOrigin ?? "real",
      archived: Boolean(item.archived),
    })),
    sessions: ((state.sessions as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      session_type: item.type,
      source_warehouse_id: warehouseDbId[String(item.sourceWarehouseId)] ?? warehouseDbId.factory,
      destination_warehouse_id: item.destinationWarehouseId ? warehouseDbId[String(item.destinationWarehouseId)] : null,
      source_session_id: isUuid(item.sourceSessionId) ? item.sourceSessionId : null,
      customer: item.customer || null,
      vehicle_number: item.vehicle || null,
      driver_name: item.driver || null,
      lr_docket: item.lr || null,
      transporter: item.transporter || null,
      notes: item.notes || null,
      expected_barcodes: item.expected ?? [],
      scanned_barcodes: item.scanned ?? [],
      finalized: Boolean(item.finalized),
      data_origin: item.dataOrigin ?? "real",
      archived: Boolean(item.archived),
      created_by: validUserId(item.createdBy),
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })),
    documents: ((state.documents as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      document_type: item.type,
      source: item.source || null,
      destination: item.destination || null,
      vehicle_number: item.vehicle || null,
      driver_name: item.driver || null,
      lr_docket: item.lr || null,
      transporter: item.transporter || null,
      notes: item.notes || null,
      discrepancy: item.discrepancy || null,
      barcode_values: item.barcodes ?? [],
      data_origin: item.dataOrigin ?? "real",
      archived: Boolean(item.archived),
      created_by: validUserId(item.createdBy),
      approver: validUserId(item.approver),
      created_at: item.createdAt,
    })),
    mismatches: ((state.mismatches as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      session_id: isUuid(item.sessionId) ? item.sessionId : null,
      status: item.status,
      missing_barcodes: item.missing ?? [],
      extra_barcodes: item.extra ?? [],
      duplicate_barcodes: item.duplicates ?? [],
      reason: item.reason || null,
      approved_by: validUserId(item.approvedBy),
      data_origin: item.dataOrigin ?? "real",
      archived: Boolean(item.archived),
      created_at: item.createdAt,
      updated_at: item.updatedAt ?? item.createdAt,
    })),
    audit: ((state.audit as Record<string, unknown>[]) ?? []).map((item) => ({
      id: item.id,
      user_id: validUserId(item.userId),
      role: item.role,
      action: item.action,
      old_value: item.oldValue ?? null,
      new_value: item.newValue ?? null,
      barcode_value: item.barcode || null,
      document_ref: item.documentRef || null,
      reason: item.reason || null,
      created_at: item.time,
    })),
  };
}

export async function GET() {
  try {
    const [settings, warehouses, profiles, products, cartons, sessions, documents, mismatches, audit] = await Promise.all([
      selectRows("system_settings", "key.asc"),
      selectRows("warehouses", "name.asc"),
      selectRows("profiles", "created_at.asc"),
      selectRows("products"),
      selectRows("cartons"),
      selectRows("scan_sessions"),
      selectRows("documents"),
      selectRows("mismatch_cases"),
      selectRows("audit_logs"),
    ]);
    const state = dbToApp({ settings, warehouses, profiles, products, cartons, sessions, documents, mismatches, audit }) as Record<string, unknown>;
    state.registry = state.cartons;
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown Supabase load error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const state = (await request.json()) as Record<string, unknown>;
    const rows = appToDb(state);
    await upsertRows("system_settings", rows.settings, "key");
    await upsertRows("products", rows.products);
    await upsertRows("cartons", rows.cartons);
    await upsertRows("scan_sessions", rows.sessions);
    await upsertRows("documents", rows.documents);
    await upsertRows("mismatch_cases", rows.mismatches);
    await upsertRows("audit_logs", rows.audit);
    await deleteMissingRows("mismatch_cases", rows.mismatches.map((item) => String(item.id)));
    await deleteMissingRows("documents", rows.documents.map((item) => String(item.id)));
    await deleteMissingRows("scan_sessions", rows.sessions.map((item) => String(item.id)));
    await deleteMissingRows("cartons", rows.cartons.map((item) => String(item.id)));
    await deleteMissingRows("products", rows.products.map((item) => String(item.id)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown Supabase save error" }, { status: 500 });
  }
}
