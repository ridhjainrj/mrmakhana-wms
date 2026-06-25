import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barcodeTemplate,
  buildBarcodeFromTemplate,
  canRole,
  maxCartonNo,
  minCartonNo,
  normalizeBarcode,
  normalizeCartonNo,
  parseQuantityFormat,
  parseTemplateBarcode,
  validateFinalizeRule,
  validateScanRule,
  type WmsCarton,
  type WmsProduct,
  type WmsScanSession,
} from "../src/lib/wms-core";

const product: WmsProduct = {
  id: "p1",
  sku: "MM-PERI-72",
  gtin: "890800100001",
  prefix: "MM",
  flavour: "Peri Peri",
  weight: "70G",
  mrp: 99,
  caseQty: 72,
  qtyUnit: "pcs",
  variantCode: "PP",
  template: barcodeTemplate,
};

function carton(overrides: Partial<WmsCarton> = {}): WmsCarton {
  return {
    barcode: buildBarcodeFromTemplate(product, "B2606A", "00001"),
    productId: product.id,
    sku: product.sku,
    gtin: product.gtin,
    flavour: product.flavour,
    weight: product.weight,
    mrp: product.mrp,
    qty: product.caseQty,
    qtyUnit: product.qtyUnit,
    batch: "B2606A",
    cartonNo: "00001",
    expiry: "2026-10-28",
    warehouseId: "factory",
    status: "IN_FACTORY",
    ...overrides,
  };
}

function session(overrides: Partial<WmsScanSession> = {}): WmsScanSession {
  return {
    id: "s1",
    type: "Factory Dispatch",
    sourceWarehouseId: "factory",
    destinationWarehouseId: "delhi",
    vehicle: "DL01AB1234",
    driver: "Ramesh",
    scanned: [],
    ...overrides,
  };
}

test("role permissions match production rules", () => {
  assert.equal(canRole("Admin", "sensitive"), true);
  assert.equal(canRole("Accountant", "sensitive"), true);
  assert.equal(canRole("Warehouse Manager", "sensitive"), false);
  assert.equal(canRole("Operator", "scan"), true);
  assert.equal(canRole("Viewer", "scan"), false);
});

test("barcode template generation and quantity parsing support pcs pc p", () => {
  for (const qtyUnit of ["pcs", "pc", "p"] as const) {
    const variantProduct = { ...product, qtyUnit };
    const barcode = buildBarcodeFromTemplate(variantProduct, "B2606A", "00009");
    const parsed = parseTemplateBarcode(barcode, [variantProduct]);
    assert.equal(parsed?.qty, 72);
    assert.equal(parsed?.qtyUnit, qtyUnit);
    assert.equal(parsed?.cartonNo, "00009");
  }
});

test("quantity formats and carton range are normalized without creating stock", () => {
  assert.deepEqual(parseQuantityFormat("48p"), { qty: 48, unit: "p" });
  assert.deepEqual(parseQuantityFormat("48 pc"), { qty: 48, unit: "pc" });
  assert.deepEqual(parseQuantityFormat("48pcs"), { qty: 48, unit: "pcs" });
  assert.equal(normalizeCartonNo(minCartonNo), "00001");
  assert.equal(normalizeCartonNo(maxCartonNo), "99999");
  assert.equal(normalizeCartonNo("00000"), null);
  assert.equal(normalizeCartonNo("100000"), null);
});

test("template parser supports five character batch codes and whitespace example strings", () => {
  const excelProduct: WmsProduct = {
    ...product,
    id: "lc",
    sku: "LC-65067-G2627-55G-48P-150-S",
    gtin: "8906160650678",
    prefix: "LC",
    weight: "55g",
    caseQty: 48,
    qtyUnit: "p",
    mrp: 150,
    variantCode: "S",
  };
  const parsed = parseTemplateBarcode("LC 8906160650678 G2627 55g 48p 150 S 00001", [excelProduct]);
  assert.equal(parsed?.barcode, normalizeBarcode("LC 8906160650678 G2627 55g 48p 150 S 00001"));
  assert.equal(parsed?.batch, "G2627");
  assert.equal(parsed?.cartonNo, "00001");
  assert.equal(parsed?.qty, 48);
});

test("duplicate scans in the same session are blocked", () => {
  const item = carton();
  const result = validateScanRule(item.barcode, session({ scanned: [item.barcode] }), [item], [product], new Date("2026-06-24"));
  assert.equal(result.ok, false);
  assert.match(result.message, /Duplicate scan/);
});

test("factory dispatch blocks wrong warehouse and already in-transit cartons", () => {
  const wrongWarehouse = carton({ warehouseId: "delhi", status: "RECEIVED_AT_WAREHOUSE" });
  const result = validateScanRule(wrongWarehouse.barcode, session(), [wrongWarehouse], [product], new Date("2026-06-24"));
  assert.equal(result.ok, false);
  assert.match(result.message, /Wrong source location/);

  const inTransit = carton({ warehouseId: "transit", status: "IN_TRANSIT" });
  const transitResult = validateScanRule(inTransit.barcode, session(), [inTransit], [product], new Date("2026-06-24"));
  assert.equal(transitResult.ok, false);
});

test("expired, damaged, and blocked cartons are blocked", () => {
  for (const status of ["DAMAGED", "BLOCKED", "EXPIRED"] as const) {
    const item = carton({ status });
    const result = validateScanRule(item.barcode, session(), [item], [product], new Date("2026-06-24"));
    assert.equal(result.ok, false);
  }
  const expiredByDate = carton({ expiry: "2026-01-01" });
  const result = validateScanRule(expiredByDate.barcode, session(), [expiredByDate], [product], new Date("2026-06-24"));
  assert.equal(result.ok, false);
});

test("receiving requires a selected dispatch and expected barcode membership", () => {
  const item = carton({ status: "IN_TRANSIT", warehouseId: "transit" });
  const noSource = validateScanRule(item.barcode, session({ type: "Warehouse Receive", sourceWarehouseId: "transit", destinationWarehouseId: "delhi" }), [item], [product], new Date("2026-06-24"));
  assert.equal(noSource.ok, false);
  assert.match(noSource.message, /selected in-transit dispatch/);

  const wrongExpected = validateScanRule(item.barcode, session({ type: "Warehouse Receive", sourceWarehouseId: "transit", destinationWarehouseId: "delhi", sourceSessionId: "dispatch-1", expected: ["other"] }), [item], [product], new Date("2026-06-24"));
  assert.equal(wrongExpected.ok, false);
  assert.match(wrongExpected.message, /not part/);

  const valid = validateScanRule(item.barcode, session({ type: "Warehouse Receive", sourceWarehouseId: "transit", destinationWarehouseId: "delhi", sourceSessionId: "dispatch-1", expected: [item.barcode] }), [item], [product], new Date("2026-06-24"));
  assert.equal(valid.ok, true);
});

test("finalization requires operational fields", () => {
  assert.equal(validateFinalizeRule(session({ vehicle: "", scanned: ["b1"] }), ["vehicle", "driver", "destinationWarehouseId"]).ok, false);
  assert.equal(validateFinalizeRule(session({ scanned: ["b1"] })).ok, true);
  assert.equal(validateFinalizeRule(session({ type: "Warehouse Receive", sourceWarehouseId: "transit", destinationWarehouseId: "delhi", scanned: ["b1"] })).ok, false);
  assert.equal(validateFinalizeRule(session({ type: "Customer Dispatch", sourceWarehouseId: "delhi", destinationWarehouseId: undefined, customer: "", scanned: ["b1"] })).ok, false);
});

test("customer dispatch only allows received warehouse stock", () => {
  const inFactory = carton();
  const result = validateScanRule(inFactory.barcode, session({ type: "Customer Dispatch", sourceWarehouseId: "delhi", customer: "Retailer" }), [inFactory], [product], new Date("2026-06-24"));
  assert.equal(result.ok, false);

  const received = carton({ warehouseId: "delhi", status: "RECEIVED_AT_WAREHOUSE" });
  const ok = validateScanRule(received.barcode, session({ type: "Customer Dispatch", sourceWarehouseId: "delhi", customer: "Retailer" }), [received], [product], new Date("2026-06-24"));
  assert.equal(ok.ok, true);

  const wrongWarehouse = carton({ warehouseId: "mumbai", status: "RECEIVED_AT_WAREHOUSE" });
  const blocked = validateScanRule(wrongWarehouse.barcode, session({ type: "Customer Dispatch", sourceWarehouseId: "delhi", customer: "Retailer" }), [wrongWarehouse], [product], new Date("2026-06-24"));
  assert.equal(blocked.ok, false);
});

test("transfer out requires available stock in the selected source warehouse", () => {
  const unavailable = carton({ warehouseId: "delhi", status: "IN_TRANSIT" });
  const blocked = validateScanRule(unavailable.barcode, session({ type: "Transfer Out", sourceWarehouseId: "delhi", destinationWarehouseId: "mumbai" }), [unavailable], [product], new Date("2026-06-24"));
  assert.equal(blocked.ok, false);

  const available = carton({ warehouseId: "delhi", status: "RECEIVED_AT_WAREHOUSE" });
  const ok = validateScanRule(available.barcode, session({ type: "Transfer Out", sourceWarehouseId: "delhi", destinationWarehouseId: "mumbai" }), [available], [product], new Date("2026-06-24"));
  assert.equal(ok.ok, true);
});
