export type WmsRole = "Admin" | "Accountant" | "Warehouse Manager" | "Operator" | "Viewer";

export type WmsStatus =
  | "IN_FACTORY"
  | "DISPATCH_PENDING"
  | "IN_TRANSIT"
  | "RECEIVED_AT_WAREHOUSE"
  | "TRANSFER_PENDING"
  | "IN_TRANSIT_TRANSFER"
  | "RECEIVED_AT_DESTINATION"
  | "DISPATCHED_TO_CUSTOMER"
  | "DELIVERED"
  | "DAMAGED"
  | "LOST"
  | "BLOCKED"
  | "EXPIRED"
  | "UNDER_INVESTIGATION"
  | "VOIDED"
  | "REVERSED";

export type WmsProduct = {
  id: string;
  sku: string;
  gtin: string;
  prefix: string;
  flavour: string;
  weight: string;
  mrp: number;
  caseQty: number;
  qtyUnit: "pcs" | "pc" | "p";
  variantCode: string;
  template: string;
};

export type ParsedTemplateBarcode = Partial<WmsCarton> & {
  product: WmsProduct;
};

export type WmsCarton = {
  barcode: string;
  productId: string;
  sku: string;
  gtin: string;
  flavour: string;
  weight: string;
  mrp: number;
  qty: number;
  qtyUnit: string;
  batch: string;
  cartonNo: string;
  expiry: string;
  warehouseId: string;
  status: WmsStatus;
};

export type WmsSessionType = "Factory Dispatch" | "Warehouse Receive" | "Transfer Out" | "Transfer In" | "Customer Dispatch";

export type WmsScanSession = {
  id: string;
  type: WmsSessionType;
  sourceWarehouseId: string;
  destinationWarehouseId?: string;
  customer?: string;
  vehicle?: string;
  driver?: string;
  expected?: string[];
  sourceSessionId?: string;
  scanned: string[];
};

export const lockedStatuses: WmsStatus[] = ["DAMAGED", "LOST", "BLOCKED", "EXPIRED", "VOIDED", "REVERSED", "UNDER_INVESTIGATION"];
export const sensitiveRoles: WmsRole[] = ["Admin", "Accountant"];
export const managerRoles: WmsRole[] = ["Admin", "Accountant", "Warehouse Manager"];
export const barcodeTemplate = "{PREFIX}{GTIN}{BATCH}{WEIGHT}{QTY}{QTY_UNIT}{MRP}{VARIANT}{CARTON_NO}";
export const minCartonNo = 1;
export const maxCartonNo = 99999;

export function normalizeBarcode(value: string) {
  return value.replace(/\s+/g, "").trim();
}

export function normalizeQtyUnit(value: string) {
  const unit = value.trim().toLowerCase();
  return unit === "pcs" || unit === "pc" || unit === "p" ? unit : null;
}

export function parseQuantityFormat(value: string | number) {
  const match = String(value).trim().match(/^(\d+)\s*(pcs|pc|p)$/i);
  if (!match) return null;
  const unit = normalizeQtyUnit(match[2]);
  return unit ? { qty: Number(match[1]), unit } : null;
}

export function normalizeCartonNo(value: string | number) {
  const raw = String(value).trim();
  const cartonNo = /^\d+$/.test(raw) ? raw.padStart(5, "0") : raw;
  if (!/^\d{5}$/.test(cartonNo)) return null;
  const numeric = Number(cartonNo);
  return numeric >= minCartonNo && numeric <= maxCartonNo ? cartonNo : null;
}

export function daysFrom(date: string, baseDate = new Date()) {
  return Math.ceil((new Date(date).getTime() - baseDate.getTime()) / 86400000);
}

export function canRole(role: WmsRole, action: "manage" | "sensitive" | "scan" | "view") {
  if (action === "view") return true;
  if (action === "sensitive") return sensitiveRoles.includes(role);
  if (action === "manage") return managerRoles.includes(role);
  if (action === "scan") return role !== "Viewer";
  return false;
}

export function buildBarcodeFromTemplate(product: WmsProduct, batch: string, cartonNo: string) {
  const values: Record<string, string> = {
    PREFIX: product.prefix,
    GTIN: product.gtin,
    BATCH: batch,
    WEIGHT: product.weight,
    QTY: String(product.caseQty),
    QTY_UNIT: product.qtyUnit,
    MRP: String(product.mrp),
    VARIANT: product.variantCode,
    CARTON_NO: cartonNo,
  };
  return normalizeBarcode((product.template || barcodeTemplate).replace(/\{([A-Z_]+)\}/g, (_, key: string) => values[key] ?? ""));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function templateRegex(product: WmsProduct) {
  const values: Record<string, string> = {
    PREFIX: product.prefix,
    GTIN: product.gtin,
    WEIGHT: product.weight,
    QTY: String(product.caseQty),
    QTY_UNIT: product.qtyUnit,
    MRP: String(product.mrp),
    VARIANT: product.variantCode,
  };
  const regex = normalizeBarcode(product.template || barcodeTemplate).replace(/\{([A-Z_]+)\}/g, (_, key: string) => {
    if (key === "BATCH") return "(?<batch>[A-Za-z0-9]+?)";
    if (key === "CARTON_NO") return "(?<cartonNo>\\d{5})";
    return escapeRegex(normalizeBarcode(values[key] ?? ""));
  });
  return new RegExp(`^${regex}$`, "i");
}

export function parseTemplateBarcode(rawBarcode: string, products: WmsProduct[]): ParsedTemplateBarcode | null {
  const barcode = normalizeBarcode(rawBarcode);
  for (const product of products) {
    const match = barcode.match(templateRegex(product));
    const cartonNo = normalizeCartonNo(match?.groups?.cartonNo ?? "");
    if (!match?.groups?.batch || !cartonNo) continue;
    const qty = parseQuantityFormat(`${product.caseQty}${product.qtyUnit}`);
    if (!qty) continue;
    return {
      product,
      barcode,
      productId: product.id,
      sku: product.sku,
      gtin: product.gtin,
      flavour: product.flavour,
      weight: product.weight,
      mrp: product.mrp,
      qty: qty.qty,
      qtyUnit: qty.unit,
      batch: match.groups.batch,
      cartonNo,
      status: "IN_FACTORY",
      warehouseId: "factory",
    };
  }
  return null;
}

export function parseLegacyTemplateBarcode(rawBarcode: string, products: WmsProduct[]): ParsedTemplateBarcode | null {
  const barcode = normalizeBarcode(rawBarcode);
  const qtyMatch = barcode.match(/(\d+)(pcs|pc|p)/i);
  const product = products.find((item) => barcode.toLowerCase().startsWith(normalizeBarcode(item.prefix + item.gtin).toLowerCase()));
  const cartonNo = normalizeCartonNo(barcode.slice(-5));
  if (!product || !qtyMatch || !cartonNo) return null;
  const qty = parseQuantityFormat(`${qtyMatch[1]}${qtyMatch[2]}`);
  if (!qty) return null;
  const batchStart = product.prefix.length + product.gtin.length;
  const batchEnd = barcode.toLowerCase().indexOf(normalizeBarcode(product.weight).toLowerCase(), batchStart);
  const batch = batchEnd > batchStart ? barcode.slice(batchStart, batchEnd) : barcode.slice(batchStart, batchStart + 6);
  return {
    product,
    barcode,
    productId: product.id,
    sku: product.sku,
    gtin: product.gtin,
    flavour: product.flavour,
    weight: product.weight,
    mrp: product.mrp,
    qty: qty.qty,
    qtyUnit: qty.unit,
    batch,
    cartonNo,
    status: "IN_FACTORY",
    warehouseId: "factory",
  };
}

export function validateScanRule(
  barcode: string,
  activeSession: WmsScanSession,
  cartons: WmsCarton[],
  products: WmsProduct[],
  baseDate = new Date(),
) {
  const carton = cartons.find((item) => item.barcode === barcode);
  if (activeSession.scanned.includes(barcode)) return { ok: false, message: "Duplicate scan blocked in this session." };
  if (!carton) {
    const parsed = parseTemplateBarcode(barcode, products);
    return parsed ? { ok: false, message: "Barcode parsed but not registered. Admin import or batch generation required first." } : { ok: false, message: "Unknown barcode. DB lookup and template parsing both failed." };
  }
  if (lockedStatuses.includes(carton.status)) return { ok: false, message: `Carton is ${carton.status}; scan blocked.` };
  if (daysFrom(carton.expiry, baseDate) < 0) return { ok: false, message: "Expired carton blocked." };
  if (activeSession.expected?.length && !activeSession.expected.includes(barcode)) return { ok: false, message: "Carton is not part of the selected dispatch/transfer." };
  if (activeSession.type === "Factory Dispatch" && (carton.warehouseId !== "factory" || carton.status !== "IN_FACTORY")) {
    return { ok: false, message: "Wrong location or invalid status for factory dispatch." };
  }
  if (activeSession.type === "Warehouse Receive" && (!activeSession.sourceSessionId || carton.status !== "IN_TRANSIT")) {
    return { ok: false, message: "Receiving must happen against a selected in-transit dispatch." };
  }
  if (activeSession.type === "Transfer Out" && carton.warehouseId !== activeSession.sourceWarehouseId) return { ok: false, message: "Carton is not in the selected source warehouse." };
  if (activeSession.type === "Transfer In" && (!activeSession.sourceSessionId || carton.status !== "IN_TRANSIT_TRANSFER")) {
    return { ok: false, message: "Transfer receiving must happen against a selected in-transit transfer." };
  }
  if (activeSession.type === "Customer Dispatch" && !["RECEIVED_AT_WAREHOUSE", "RECEIVED_AT_DESTINATION"].includes(carton.status)) return { ok: false, message: "Only received warehouse stock can be dispatched to customer." };
  return { ok: true, message: `${carton.sku} carton ${carton.cartonNo} accepted.` };
}

export function validateFinalizeRule(activeSession: WmsScanSession) {
  if (activeSession.scanned.length === 0) return { ok: false, message: "Scan at least one carton before finalization." };
  if (activeSession.type === "Factory Dispatch") {
    if (!activeSession.vehicle?.trim()) return { ok: false, message: "Vehicle number is required for factory dispatch." };
    if (!activeSession.driver?.trim()) return { ok: false, message: "Driver name is required for factory dispatch." };
    if (!activeSession.destinationWarehouseId) return { ok: false, message: "Destination warehouse is required for factory dispatch." };
  }
  if ((activeSession.type === "Warehouse Receive" || activeSession.type === "Transfer In") && !activeSession.sourceSessionId) {
    return { ok: false, message: "Select a source dispatch/transfer before receiving." };
  }
  if (activeSession.type === "Transfer Out" && !activeSession.destinationWarehouseId) return { ok: false, message: "Destination warehouse is required for transfer." };
  if (activeSession.type === "Customer Dispatch" && !activeSession.customer?.trim()) return { ok: false, message: "Customer name is required for customer dispatch." };
  return { ok: true, message: "Ready to finalize." };
}
