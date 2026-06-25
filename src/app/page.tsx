"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FileText,
  History,
  Lock,
  LogOut,
  MapPin,
  Menu,
  PackageCheck,
  Printer,
  QrCode,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Truck,
  Upload,
  UserCog,
  Users,
  Warehouse,
  XCircle,
} from "lucide-react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { readSheet } from "read-excel-file/browser";
import { Button, Card, EmptyState, SelectField, Stat, StatusBadge, Tag, TextField } from "@/components/wms/ui";
import {
  barcodeTemplate,
  buildBarcodeFromTemplate,
  canRole,
  daysFrom,
  lockedStatuses,
  maxCartonNo,
  minCartonNo,
  normalizeBarcode,
  normalizeCartonNo,
  parseQuantityFormat,
  parseTemplateBarcode,
  validateFinalizeRule,
  validateScanRule,
} from "@/lib/wms-core";

type Role = "Admin" | "Accountant" | "Warehouse Manager" | "Operator" | "Viewer";
type AppMode = "development" | "production";
type DataOrigin = "demo" | "real" | "system";
type Status =
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

type User = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  warehouseId: string;
  warehouseAccess?: string[];
  disabled?: boolean;
  archived?: boolean;
  passwordResetAt?: string;
};

type Product = {
  id: string;
  name: string;
  category: string;
  sku: string;
  gtin: string;
  prefix: string;
  flavour: string;
  weight: string;
  mrp: number;
  caseQty: number;
  qtyUnit: "pcs" | "pc" | "p";
  variantCode: string;
  shelfLifeDays: number;
  hsn?: string;
  status: "Active" | "Blocked";
  template: string;
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type BarcodePattern = {
  id: string;
  productId: string;
  sku: string;
  prefix: string;
  gtin: string;
  batchPattern: string;
  weight: string;
  caseQty: number;
  qtyUnit: "pcs" | "pc" | "p";
  mrp: number;
  variantCode: string;
  template: string;
  exampleBarcode: string;
  cartonRangeStart: string;
  cartonRangeEnd: string;
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type WarehouseRecord = {
  id: string;
  dbId?: string;
  name: string;
  type: "factory" | "warehouse" | "transit" | "damage-hold" | "virtual";
  archived?: boolean;
};

type Carton = {
  id: string;
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
  mfd: string;
  expiry: string;
  cartonNo: string;
  warehouseId: string;
  status: Status;
  customer?: string;
  blockedReason?: string;
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type AuditLog = {
  id: string;
  time: string;
  userId: string;
  role: Role;
  action: string;
  barcode?: string;
  documentRef?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
};

type DocumentRecord = {
  id: string;
  type: string;
  createdAt: string;
  createdBy: string;
  approver?: string;
  source?: string;
  destination?: string;
  vehicle?: string;
  driver?: string;
  lr?: string;
  transporter?: string;
  notes?: string;
  discrepancy?: string;
  barcodes: string[];
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type ScanSession = {
  id: string;
  type: "Factory Dispatch" | "Warehouse Receive" | "Transfer Out" | "Transfer In" | "Customer Dispatch";
  sourceWarehouseId: string;
  destinationWarehouseId?: string;
  sourceSessionId?: string;
  customer?: string;
  vehicle?: string;
  driver?: string;
  lr?: string;
  transporter?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  scanned: string[];
  expected?: string[];
  finalized: boolean;
  mismatch?: string;
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type MismatchCase = {
  id: string;
  sessionId: string;
  status: "Open" | "Approved shortage" | "Closed" | "Reopened";
  createdAt: string;
  missing: string[];
  extra: string[];
  duplicates: string[];
  approvedBy?: string;
  reason?: string;
  dataOrigin?: DataOrigin;
  archived?: boolean;
};

type InventoryAggregateRow = {
  key: string;
  product: string;
  sku: string;
  gtin: string;
  batch: string;
  warehouse: string;
  cartons: number;
  unitsPerCarton: number;
  totalUnits: number;
  status: Status;
  lastMovement: string;
  sampleBarcode: string;
};

type PermissionAction = "view" | "create" | "edit" | "archive" | "delete" | "approve" | "export" | "import";
type MasterStatus = "Active" | "Inactive" | "Archived";
type MasterKey =
  | "roles"
  | "customers"
  | "transporters"
  | "vehicles"
  | "drivers"
  | "locations"
  | "skus"
  | "barcodeTemplates"
  | "batches"
  | "documentNumbering"
  | "approvalRules"
  | "approvalReasons"
  | "adjustmentReasons"
  | "damageReasons"
  | "numberingSeries";

type MasterRecord = {
  id: string;
  name: string;
  code: string;
  status: MasterStatus;
  description?: string;
  owner?: string;
  updatedAt: string;
  archived?: boolean;
};

type PermissionGrant = {
  role: Role;
  module: string;
  actions: PermissionAction[];
};

type ManagementSettings = {
  defaultFactory: string;
  defaultWarehouse: string;
  stockRule: "FEFO" | "FIFO";
  nearExpiryWarningDays: number;
  autoFocusScanner: boolean;
  scannerSounds: boolean;
  autoRegisterCartonOnFirstScan: boolean;
  requiredDispatchFields: string[];
  requiredReceivingFields: string[];
  twoLevelApprovals: boolean;
  barcodeFormatDefault: string;
  cartonNumberLength: number;
  documentPrefixes: Record<string, string>;
};

type ManagementConfig = {
  masters: Record<MasterKey, MasterRecord[]>;
  permissions: PermissionGrant[];
  settings: ManagementSettings;
  managedUsers: User[];
  managedWarehouses: WarehouseRecord[];
};

type AppState = {
  settings: {
    mode: AppMode;
    goLiveAt?: string;
    supabaseProjectRef?: string;
  };
  users: User[];
  products: Product[];
  warehouses: WarehouseRecord[];
  cartons: Carton[];
  sessions: ScanSession[];
  documents: DocumentRecord[];
  mismatches: MismatchCase[];
  audit: AuditLog[];
  registry: Carton[];
  barcodePatterns: BarcodePattern[];
  managementConfig: ManagementConfig;
};

type ImportPreviewRow = {
  rowNumber: number;
  product: Product;
  pattern: BarcodePattern;
  status: "valid" | "duplicate" | "error";
  messages: string[];
};

function now() {
  return new Date().toISOString();
}

function uid(...parts: string[]) {
  void parts;
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generateBarcode(product: Product, batch: string, cartonNo: string) {
  return buildBarcodeFromTemplate(product, batch, cartonNo);
}

function normalizeSkuPart(value: string | number | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase();
}

function buildSkuFromMaster(prefix: string, gtin: string, batch: string, weight: string, qty: number, qtyUnit: string, mrp: number, variant: string) {
  return [prefix, gtin.slice(-5), batch, weight, `${qty}${qtyUnit}`, mrp, variant].map(normalizeSkuPart).filter(Boolean).join("-");
}

function patternIdFor(product: Pick<Product, "sku">) {
  return `pattern-${normalizeSkuPart(product.sku).toLowerCase()}`;
}

function buildPattern(product: Product, batchPattern = "{BATCH}", exampleBatch = "BATCH1"): BarcodePattern {
  return {
    id: patternIdFor(product),
    productId: product.id,
    sku: product.sku,
    prefix: product.prefix,
    gtin: product.gtin,
    batchPattern,
    weight: product.weight,
    caseQty: product.caseQty,
    qtyUnit: product.qtyUnit,
    mrp: product.mrp,
    variantCode: product.variantCode,
    template: product.template,
    exampleBarcode: generateBarcode(product, exampleBatch, "00001"),
    cartonRangeStart: "00001",
    cartonRangeEnd: "99999",
    dataOrigin: product.dataOrigin,
    archived: product.archived,
  };
}

const permissionModules = [
  "Admin Panel",
  "Dashboard",
  "Dispatches",
  "Scan",
  "Inventory",
  "Receiving",
  "Shipments",
  "Factory Management",
  "Warehouse Management",
  "Products",
  "Customers",
  "Users",
  "Locations",
  "Import Data",
  "Documents",
  "Reports",
  "Audit Logs",
  "Demo / Production Mode",
  "Checklist",
  "Settings",
];

const permissionActions: PermissionAction[] = ["view", "create", "edit", "archive", "delete", "approve", "export", "import"];

function masterRecord(name: string, code: string, description = "", owner = "System"): MasterRecord {
  return { id: uid("master"), name, code, description, owner, status: "Active", updatedAt: now() };
}

function defaultPermissions(): PermissionGrant[] {
  return (["Admin", "Accountant", "Warehouse Manager", "Operator", "Viewer"] as Role[]).flatMap((role) =>
    permissionModules.map((module) => {
      const actions: PermissionAction[] =
        role === "Admin"
          ? [...permissionActions]
          : role === "Accountant"
            ? ["view", "approve", "export"]
            : role === "Warehouse Manager"
              ? ["view", "create", "edit", "approve", "export"]
              : role === "Operator"
                ? module === "Scan" || ["Dispatches", "Receiving", "Shipments", "Inventory"].includes(module)
                  ? ["view", "create"]
                  : []
                : ["view", "export"];
      return { role, module, actions };
    }),
  );
}

function defaultManagementConfig(): ManagementConfig {
  return {
    masters: {
      roles: [
        masterRecord("Admin", "ADMIN", "Full system access"),
        masterRecord("Accountant", "ACCT", "Approvals and financial reports"),
        masterRecord("Warehouse Manager", "WHM", "Warehouse operations"),
        masterRecord("Operator", "OPER", "Scanner and floor workflows"),
        masterRecord("Viewer", "VIEW", "Read-only management visibility"),
      ],
      customers: [masterRecord("Modern Trade Customer", "CUST-MODERN", "Default customer dispatch account")],
      locations: [
        masterRecord("Factory", "LOC-FACTORY", "Default production location"),
        masterRecord("Delhi Warehouse", "LOC-DELHI", "Default receiving warehouse"),
        masterRecord("In Transit", "LOC-TRANSIT", "Virtual transit location"),
        masterRecord("Damage Hold", "LOC-DAMAGE", "Quarantine location for damaged cartons"),
      ],
      skus: [masterRecord("Default SKU registry", "SKU-MASTER", "SKU records are also generated from Product Master")],
      barcodeTemplates: [masterRecord("Default carton template", "BCT-DEFAULT", barcodeTemplate)],
      batches: [masterRecord("Production batch registry", "BAT-MASTER", "Batches are generated from product workflows")],
      documentNumbering: [
        masterRecord("Dispatch Slip", "DSP", "Factory and customer dispatch numbering"),
        masterRecord("Receiving Slip", "RCV", "Warehouse receiving numbering"),
        masterRecord("Transfer Slip", "TRF", "Warehouse transfer numbering"),
      ],
      approvalRules: [
        masterRecord("Shortage approval", "APR-SHORTAGE", "Admin or Accountant approval required"),
        masterRecord("Barcode reprint approval", "APR-REPRINT", "Reason and audit log required"),
      ],
      transporters: [masterRecord("Primary Transporter", "TRN-PRIMARY", "Default logistics partner")],
      vehicles: [masterRecord("Default Vehicle", "VEH-001", "Use only for UAT workflows")],
      drivers: [masterRecord("Default Driver", "DRV-001", "Use only for UAT workflows")],
      approvalReasons: [
        masterRecord("Physical shortage verified", "APR-SHORTAGE"),
        masterRecord("Supervisor exception approval", "APR-EXCEPTION"),
      ],
      adjustmentReasons: [
        masterRecord("Cycle count correction", "ADJ-CYCLE"),
        masterRecord("Opening balance correction", "ADJ-OPENING"),
      ],
      damageReasons: [
        masterRecord("Transit damage", "DMG-TRANSIT"),
        masterRecord("Warehouse handling damage", "DMG-HANDLING"),
      ],
      numberingSeries: [
        masterRecord("Dispatch Slip", "DSP", "Factory and customer dispatch series"),
        masterRecord("Receiving Slip", "RCV", "Warehouse receiving series"),
        masterRecord("Transfer Slip", "TRF", "Warehouse transfer series"),
        masterRecord("Batch Slip", "BAT", "Production batch series"),
      ],
    },
    permissions: defaultPermissions(),
    settings: {
      defaultFactory: "factory",
      defaultWarehouse: "delhi",
      stockRule: "FEFO",
      nearExpiryWarningDays: 45,
      autoFocusScanner: true,
      scannerSounds: true,
      autoRegisterCartonOnFirstScan: true,
      requiredDispatchFields: ["vehicle", "driver", "destinationWarehouseId"],
      requiredReceivingFields: ["sourceSessionId"],
      twoLevelApprovals: true,
      barcodeFormatDefault: barcodeTemplate,
      cartonNumberLength: 5,
      documentPrefixes: { batch: "BAT", dispatch: "DSP", receiving: "RCV", transfer: "TRF", customerDispatch: "CUS", damage: "DMG", shortage: "SHR", adjustment: "ADJ" },
    },
    managedUsers: [],
    managedWarehouses: [],
  };
}

function normalizeManagementConfig(raw?: Partial<ManagementConfig>): ManagementConfig {
  const defaults = defaultManagementConfig();
  return {
    masters: { ...defaults.masters, ...(raw?.masters ?? {}) },
    permissions: raw?.permissions?.length ? raw.permissions : defaults.permissions,
    settings: { ...defaults.settings, ...(raw?.settings ?? {}) },
    managedUsers: Array.isArray(raw?.managedUsers) ? raw.managedUsers : defaults.managedUsers,
    managedWarehouses: Array.isArray(raw?.managedWarehouses) ? raw.managedWarehouses : defaults.managedWarehouses,
  };
}

function emptyState(): AppState {
  return {
    settings: { mode: "development", supabaseProjectRef: "yagdnrnfqbqcqgcbejuc" },
    users: [],
    products: [],
    warehouses: [],
    cartons: [],
    sessions: [],
    documents: [],
    mismatches: [],
    audit: [],
    registry: [],
    barcodePatterns: [],
    managementConfig: defaultManagementConfig(),
  };
}
function can(user: User, action: "manage" | "sensitive" | "scan" | "view") {
  return canRole(user.role, action);
}

function hasPermission(state: AppState, user: User, module: string, action: PermissionAction) {
  if (user.role === "Admin") return true;
  const grant = state.managementConfig.permissions.find((item) => item.role === user.role && item.module === module);
  return Boolean(grant?.actions.includes(action));
}

function isOperationalRecord(record: { dataOrigin?: DataOrigin; archived?: boolean }, mode: AppMode) {
  if (record.archived) return false;
  if (mode === "production" && record.dataOrigin === "demo") return false;
  return true;
}

function isDemoRecord(record: { dataOrigin?: DataOrigin }) {
  return record.dataOrigin === "demo";
}

export default function Home() {
  const [state, setState] = useState<AppState>(() => emptyState());
  const [activeUserId, setActiveUserId] = useState("");
  const [backendStatus, setBackendStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [backendMessage, setBackendMessage] = useState("Loading WMS data from Supabase...");
  const [email, setEmail] = useState("admin@mrmakhana.test");
  const [password, setPassword] = useState("Admin@123");
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState("Dashboard");
  const [scanInput, setScanInput] = useState("");
  const [scanMessage, setScanMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [search, setSearch] = useState("");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryWarehouse, setInventoryWarehouse] = useState("");
  const [inventoryBatch, setInventoryBatch] = useState("");
  const [inventoryStatus, setInventoryStatus] = useState("");
  const [inventoryProduct, setInventoryProduct] = useState("");
  const [inventoryExpiry, setInventoryExpiry] = useState("");
  const [selectedCartonBarcode, setSelectedCartonBarcode] = useState("");
  const [scanFullscreen, setScanFullscreen] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importStep, setImportStep] = useState<"Upload" | "Preview" | "Validate" | "Import" | "Summary">("Upload");
  const [importSummary, setImportSummary] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<"checking" | "connected" | "missing" | "error">(() =>
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "checking" : "missing",
  );
  const scanRef = useRef<HTMLInputElement>(null);

  const user = state.users.find((item) => item.id === activeUserId) ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wms", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load Supabase WMS data.");
        return response.json() as Promise<AppState>;
      })
      .then((data) => {
        if (cancelled) return;
        const next = { ...data, registry: data.cartons, barcodePatterns: data.barcodePatterns ?? [], managementConfig: normalizeManagementConfig(data.managementConfig) };
        setState(next);
        setActiveUserId("");
        setBackendStatus("ready");
        setBackendMessage("Supabase data loaded.");
      })
      .catch((error) => {
        if (cancelled) return;
        setBackendStatus("error");
        setBackendMessage(error instanceof Error ? error.message : "Unable to load Supabase WMS data.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!session || session.finalized) return;
      if (Date.now() - new Date(session.updatedAt).getTime() > 30 * 60 * 1000) {
        setSession(null);
        setScanMessage({ type: "error", text: "Inactive scan session auto-locked after 30 minutes." });
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    scanRef.current?.focus();
  }, [view, session]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })
      .then((response) => setSupabaseStatus(response.ok ? "connected" : "error"))
      .catch(() => setSupabaseStatus("error"));
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(state.warehouses.map((item) => [item.id, item.name])), [state.warehouses]);
  const factoryWarehouseId = useMemo(() => state.warehouses.find((item) => item.type === "factory")?.id ?? "factory", [state.warehouses]);
  const transitWarehouseId = useMemo(() => state.warehouses.find((item) => item.type === "transit")?.id ?? "transit", [state.warehouses]);
  const primaryWarehouseId = useMemo(() => state.warehouses.find((item) => item.type === "warehouse")?.id ?? user?.warehouseId ?? "delhi", [state.warehouses, user?.warehouseId]);
  const transferWarehouseId = useMemo(() => state.warehouses.find((item) => item.type === "warehouse" && item.id !== primaryWarehouseId)?.id ?? primaryWarehouseId, [primaryWarehouseId, state.warehouses]);
  const productById = useMemo(() => Object.fromEntries(state.products.map((item) => [item.id, item])), [state.products]);
  const operationalProducts = useMemo(() => state.products.filter((item) => isOperationalRecord(item, state.settings.mode)), [state.products, state.settings.mode]);
  const operationalCartons = useMemo(() => state.cartons.filter((item) => isOperationalRecord(item, state.settings.mode)), [state.cartons, state.settings.mode]);
  const operationalSessions = useMemo(() => state.sessions.filter((item) => isOperationalRecord(item, state.settings.mode)), [state.sessions, state.settings.mode]);
  const operationalDocuments = useMemo(() => state.documents.filter((item) => isOperationalRecord(item, state.settings.mode)), [state.documents, state.settings.mode]);
  const operationalMismatches = useMemo(() => state.mismatches.filter((item) => isOperationalRecord(item, state.settings.mode)), [state.mismatches, state.settings.mode]);
  const demoCounts = useMemo(
    () => ({
      products: state.products.filter(isDemoRecord).length,
      cartons: state.cartons.filter(isDemoRecord).length,
      sessions: state.sessions.filter(isDemoRecord).length,
      documents: state.documents.filter(isDemoRecord).length,
      mismatches: state.mismatches.filter(isDemoRecord).length,
      archived: [
        ...state.products,
        ...state.cartons,
        ...state.sessions,
        ...state.documents,
        ...state.mismatches,
      ].filter((item) => isDemoRecord(item) && item.archived).length,
    }),
    [state],
  );

  const metrics = useMemo(() => {
    const active = operationalCartons.filter((carton) => !["VOIDED", "REVERSED"].includes(carton.status));
    return {
      cartons: active.length,
      units: active.reduce((sum, carton) => sum + carton.qty, 0),
      inTransit: active.filter((carton) => carton.status.includes("IN_TRANSIT")).length,
      blocked: active.filter((carton) => lockedStatuses.includes(carton.status)).length,
      nearExpiry: active.filter((carton) => daysFrom(carton.expiry) <= 45 && daysFrom(carton.expiry) >= 0).length,
      missing: operationalMismatches.filter((item) => item.status !== "Closed").reduce((sum, item) => sum + item.missing.length, 0),
    };
  }, [operationalCartons, operationalMismatches]);

  const sourceSessions = useMemo(() => {
    const hasMovableExpected = (item: ScanSession, status: Status) =>
      item.scanned.some((barcode) => operationalCartons.find((carton) => carton.barcode === barcode)?.status === status);
    return {
      receiving: operationalSessions.filter((item) => item.finalized && item.type === "Factory Dispatch" && hasMovableExpected(item, "IN_TRANSIT")),
      transferIn: operationalSessions.filter((item) => item.finalized && item.type === "Transfer Out" && hasMovableExpected(item, "IN_TRANSIT_TRANSFER")),
    };
  }, [operationalCartons, operationalSessions]);

  const persistState = useCallback((next: AppState) => {
    setBackendStatus("saving");
    setBackendMessage("Saving operational data to Supabase...");
    fetch("/api/wms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wms-user-id": user?.id ?? "", "x-wms-role": user?.role ?? "anonymous" },
      body: JSON.stringify({ ...next, registry: next.cartons, barcodePatterns: next.barcodePatterns ?? [] }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error ?? "Supabase save failed.");
        setBackendStatus("ready");
        setBackendMessage("Operational data saved in Supabase.");
      })
      .catch((error) => {
        setBackendStatus("error");
        setBackendMessage(error instanceof Error ? error.message : "Supabase save failed.");
      });
  }, [user?.id, user?.role]);

  function mutate(updater: (draft: AppState) => void) {
    setState((current) => {
      const draft: AppState = JSON.parse(JSON.stringify(current));
      updater(draft);
      draft.registry = draft.cartons;
      draft.barcodePatterns = draft.barcodePatterns ?? [];
      persistState(draft);
      return draft;
    });
  }

  function audit(action: string, details: Partial<AuditLog> = {}) {
    if (!user) return;
    mutate((draft) => {
      draft.audit.unshift({
        id: uid("audit"),
        time: now(),
        userId: user.id,
        role: user.role,
        action,
        ...details,
      });
    });
  }

  function login() {
  const found = state.users.find((item) => item.email.toLowerCase() === email.toLowerCase() && item.password === password);
    if (!found) {
      setLoginError("Invalid email or password.");
      return;
    }
    if (found.disabled || found.archived) {
      setLoginError("This user is disabled or archived. Contact Admin.");
      return;
    }
    setLoginError("");
    setActiveUserId(found.id);
    setView("Dashboard");
  }

  function logout() {
    setActiveUserId("");
    setSession(null);
    setView("Dashboard");
  }

  function startSession(type: ScanSession["type"]) {
    if (!user || !can(user, "scan")) return;
    const source = type === "Warehouse Receive" ? sourceSessions.receiving[0] : type === "Transfer In" ? sourceSessions.transferIn[0] : undefined;
    const sourceWarehouseId = type === "Factory Dispatch" ? factoryWarehouseId : type === "Warehouse Receive" ? transitWarehouseId : type === "Transfer In" ? transitWarehouseId : user.warehouseId;
    const destinationWarehouseId = type === "Factory Dispatch" ? primaryWarehouseId : type === "Warehouse Receive" || type === "Transfer In" ? user.warehouseId : type === "Transfer Out" ? transferWarehouseId : undefined;
    setSession({
      id: uid("session"),
      type,
      sourceWarehouseId,
      destinationWarehouseId,
      sourceSessionId: source?.id,
      expected: source?.scanned ?? [],
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now(),
      scanned: [],
      finalized: false,
      dataOrigin: source?.dataOrigin ?? (state.settings.mode === "production" ? "real" : "demo"),
    });
    setScanMessage(null);
    setView("Scan");
  }

  function validateScan(barcode: string, activeSession: ScanSession) {
    const duplicateDraft = operationalSessions.find((item) => !item.finalized && item.id !== activeSession.id && item.scanned.includes(barcode));
    if (duplicateDraft) return { ok: false, message: `Duplicate scan blocked: carton is already in draft ${duplicateDraft.type}.` };
    return validateScanRule(barcode, activeSession, operationalCartons, operationalProducts);
  }

  function playScanTone(type: "ok" | "error") {
    if (!state.managementConfig.settings.scannerSounds || typeof window === "undefined") return;
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    try {
      const audio = new AudioCtor();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = type === "ok" ? 880 : 220;
      gain.gain.value = 0.04;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.08);
      window.setTimeout(() => audio.close().catch(() => undefined), 140);
    } catch {
      // Audio feedback is optional; scans must never fail because sound is blocked.
    }
  }

  function handleScan(raw: string) {
    if (!session || !user) return;
    const barcode = normalizeBarcode(raw);
    if (!barcode) return;
    const existingCarton = operationalCartons.find((item) => item.barcode === barcode);
    if (!existingCarton) {
      const parsed = parseTemplateBarcode(barcode, operationalProducts);
      if (parsed?.product && session.type === "Factory Dispatch") {
        const duplicateDraft = operationalSessions.find((item) => !item.finalized && item.id !== session.id && item.scanned.includes(barcode));
        if (duplicateDraft || session.scanned.includes(barcode)) {
          setScanMessage({ type: "error", text: "Duplicate scan blocked." });
          setScanInput("");
          playScanTone("error");
          return;
        }
        const product = parsed.product as Product;
        const generatedAt = new Date();
        const mfd = generatedAt.toISOString().slice(0, 10);
        const expiryDate = new Date(generatedAt);
        expiryDate.setDate(expiryDate.getDate() + product.shelfLifeDays);
        const lazyCarton: Carton = {
          id: uid("carton"),
          barcode,
          productId: product.id,
          sku: product.sku,
          gtin: product.gtin,
          flavour: product.flavour,
          weight: product.weight,
          mrp: product.mrp,
          qty: product.caseQty,
          qtyUnit: product.qtyUnit,
          batch: String(parsed.batch),
          mfd,
          expiry: expiryDate.toISOString().slice(0, 10),
          cartonNo: String(parsed.cartonNo),
          warehouseId: factoryWarehouseId,
          status: "IN_FACTORY",
          dataOrigin: product.dataOrigin ?? "real",
        };
        mutate((draft) => {
          if (!draft.cartons.some((item) => item.barcode === barcode)) draft.cartons.push(lazyCarton);
        });
        setSession({ ...session, scanned: [barcode, ...session.scanned], updatedAt: now(), dataOrigin: lazyCarton.dataOrigin });
        setScanMessage({ type: "ok", text: `${lazyCarton.sku} carton ${lazyCarton.cartonNo} created lazily and accepted.` });
        setScanInput("");
        playScanTone("ok");
        window.navigator.vibrate?.(35);
        return;
      }
    }
    const result = validateScan(barcode, session);
    setScanMessage({ type: result.ok ? "ok" : "error", text: result.message });
    if (!result.ok) {
      setScanInput("");
      playScanTone("error");
      return;
    }
    setSession({ ...session, scanned: [barcode, ...session.scanned], updatedAt: now() });
    setScanInput("");
    playScanTone("ok");
    window.navigator.vibrate?.(35);
  }

  function undoLastScan() {
    if (!session || session.scanned.length === 0) return;
    setSession({ ...session, scanned: session.scanned.slice(1), updatedAt: now() });
    setScanMessage({ type: "ok", text: "Last scan removed before finalization." });
  }

  function saveDraft() {
    if (!session || !user) return;
    mutate((draft) => {
      const index = draft.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) draft.sessions[index] = session;
      else draft.sessions.unshift(session);
    });
    setScanMessage({ type: "ok", text: "Draft scan session saved." });
  }

  function resumeDraft(id: string) {
    const draft = state.sessions.find((item) => item.id === id && !item.finalized);
    if (draft) {
      setSession(draft);
      setView("Scan");
    }
  }

  function updateSourceSession(sourceSessionId: string) {
    if (!session) return;
    const source = [...sourceSessions.receiving, ...sourceSessions.transferIn].find((item) => item.id === sourceSessionId);
    setSession({
      ...session,
      sourceSessionId: source?.id,
      expected: source?.scanned ?? [],
      scanned: [],
      updatedAt: now(),
    });
    setScanMessage({ type: "ok", text: "Source session changed. Scan list reset for audit accuracy." });
  }

  function finalizeSession() {
    if (!session || !user || session.scanned.length === 0) return;
    const finalizeCheck = validateFinalizeRule(session);
    if (!finalizeCheck.ok) {
      setScanMessage({ type: "error", text: finalizeCheck.message });
      return;
    }
    const docType =
      session.type === "Factory Dispatch"
        ? "Factory Dispatch Slip"
        : session.type === "Warehouse Receive"
          ? "Warehouse Receiving Slip"
          : session.type === "Transfer Out"
            ? "Warehouse Transfer Out Slip"
            : session.type === "Transfer In"
              ? "Warehouse Transfer In Slip"
              : "Customer Dispatch Slip";
    const docId = `${docType.split(" ").map((word) => word[0]).join("")}-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(state.documents.length + 1).padStart(3, "0")}`;
    const newStatus: Partial<Record<ScanSession["type"], Status>> = {
      "Factory Dispatch": "IN_TRANSIT",
      "Warehouse Receive": "RECEIVED_AT_WAREHOUSE",
      "Transfer Out": "IN_TRANSIT_TRANSFER",
      "Transfer In": "RECEIVED_AT_DESTINATION",
      "Customer Dispatch": "DISPATCHED_TO_CUSTOMER",
    };
    const expected = session.expected ?? [];
    const missing = expected.filter((barcode) => !session.scanned.includes(barcode));
    const extra = expected.length ? session.scanned.filter((barcode) => !expected.includes(barcode)) : [];
    mutate((draft) => {
      session.scanned.forEach((barcode) => {
        const carton = draft.cartons.find((item) => item.barcode === barcode);
        if (!carton) return;
        const oldValue = carton.status;
        carton.status = newStatus[session.type] ?? carton.status;
        carton.warehouseId = session.type.includes("Dispatch") || session.type === "Transfer Out" ? transitWarehouseId : session.destinationWarehouseId ?? carton.warehouseId;
        if (session.type === "Customer Dispatch") carton.customer = session.customer || "Modern Trade Customer";
        draft.audit.unshift({
          id: uid("audit"),
          time: now(),
          userId: user.id,
          role: user.role,
          action: `${session.type} finalized`,
          barcode,
          documentRef: docId,
          oldValue,
          newValue: carton.status,
        });
      });
      const finalized = { ...session, finalized: true, updatedAt: now(), mismatch: missing.length || extra.length ? "Mismatch found" : undefined };
      const sessionIndex = draft.sessions.findIndex((item) => item.id === session.id);
      if (sessionIndex >= 0) draft.sessions[sessionIndex] = finalized;
      else draft.sessions.unshift(finalized);
      draft.documents.unshift({
        id: docId,
        type: docType,
        createdAt: now(),
        createdBy: user.id,
        source: warehouseById[session.sourceWarehouseId],
        destination: session.destinationWarehouseId ? warehouseById[session.destinationWarehouseId] : session.customer,
        vehicle: session.vehicle,
        driver: session.driver,
        lr: session.lr,
        transporter: session.transporter,
        notes: session.notes,
        discrepancy: missing.length || extra.length ? `Missing: ${missing.length}, Extra: ${extra.length}` : undefined,
        barcodes: session.scanned,
        dataOrigin: session.dataOrigin,
      });
      if (session.type === "Factory Dispatch") {
        draft.documents.unshift({
          id: `VLS-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`,
          type: "Vehicle Loading Slip",
          createdAt: now(),
          createdBy: user.id,
          source: warehouseById[session.sourceWarehouseId],
          destination: session.destinationWarehouseId ? warehouseById[session.destinationWarehouseId] : undefined,
          vehicle: session.vehicle,
          driver: session.driver,
          lr: session.lr,
          transporter: session.transporter,
          notes: session.notes,
          barcodes: session.scanned,
          dataOrigin: session.dataOrigin,
        });
      }
      if (session.type === "Customer Dispatch") {
        draft.documents.unshift({
          id: `DC-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`,
          type: "Delivery Challan style slip",
          createdAt: now(),
          createdBy: user.id,
          source: warehouseById[session.sourceWarehouseId],
          destination: session.customer,
          vehicle: session.vehicle,
          driver: session.driver,
          lr: session.lr,
          transporter: session.transporter,
          notes: session.notes,
          barcodes: session.scanned,
          dataOrigin: session.dataOrigin,
        });
      }
      if (missing.length || extra.length) {
        draft.mismatches.unshift({
          id: `CASE-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.mismatches.length + 1).padStart(3, "0")}`,
          sessionId: session.id,
          status: "Open",
          createdAt: now(),
          missing,
          extra,
          duplicates: [],
          reason: "Auto-created from receiving/transfer mismatch.",
          dataOrigin: session.dataOrigin,
        });
      }
    });
    setSession(null);
    setScanMessage({ type: "ok", text: `${docType} finalized and inventory moved.` });
    setView("Documents");
  }

  async function downloadDocument(doc: DocumentRecord) {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const qr = await QRCode.toDataURL(doc.id);
    const userName = state.users.find((item) => item.id === doc.createdBy)?.name ?? "System";
    const rows = doc.barcodes.map((barcode) => state.cartons.find((carton) => carton.barcode === barcode)).filter(Boolean) as Carton[];
    pdf.setFontSize(18);
    pdf.text("Mr Makhana WMS", 42, 48);
    pdf.setFontSize(12);
    pdf.text(doc.type, 42, 72);
    pdf.addImage(qr, "PNG", 478, 36, 72, 72);
    const lines = [
      `Document: ${doc.id}`,
      `Date/time: ${new Date(doc.createdAt).toLocaleString()}`,
      `Source: ${doc.source ?? "-"}`,
      `Destination: ${doc.destination ?? "-"}`,
      `Created by: ${userName}`,
      `Approver: ${doc.approver ?? "-"}`,
      `Vehicle/Driver/LR: ${doc.vehicle ?? "-"} / ${doc.driver ?? "-"} / ${doc.lr ?? "-"}`,
      `Transporter: ${doc.transporter ?? "-"}`,
      `Carton count: ${doc.barcodes.length}`,
      `Discrepancy: ${doc.discrepancy ?? "None"}`,
    ];
    lines.forEach((line, index) => pdf.text(line, 42, 118 + index * 18));
    const summary = Object.entries(
      rows.reduce<Record<string, number>>((acc, carton) => {
        const key = `${carton.sku} / ${carton.batch}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    );
    pdf.text("SKU / batch summary", 42, 326);
    summary.forEach(([key, count], index) => pdf.text(`${key}: ${count} cartons`, 42, 346 + index * 16));
    pdf.text("Barcode / carton list", 42, 394);
    rows.slice(0, 24).forEach((carton, index) => {
      pdf.text(`${index + 1}. ${carton.barcode} | ${carton.sku} | ${carton.cartonNo} | ${carton.status}`, 42, 416 + index * 14);
    });
    if (rows.length > 24) pdf.text(`+ ${rows.length - 24} more cartons in CSV export`, 42, 760);
    pdf.save(`${doc.id}.pdf`);
  }

  async function reprintDocument(doc: DocumentRecord, reason: string) {
    if (!user || !can(user, "sensitive") || !reason.trim()) {
      setScanMessage({ type: "error", text: "Admin/Accountant reprints require a reason." });
      return;
    }
    audit("Document reprinted", { documentRef: doc.id, reason });
    try {
      await downloadDocument(doc);
      setScanMessage({ type: "ok", text: `${doc.id} PDF generated and reprint audit saved.` });
    } catch {
      setScanMessage({ type: "error", text: "PDF generation failed, but the reprint attempt was audited." });
    }
  }

  function exportCsv(name: string, rows: Record<string, string | number | undefined>[]) {
    const headers = Object.keys(rows[0] ?? { empty: "" });
    const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function parseSkuMasterRow(row: Record<string, string | number>, rowNumber: number, seenSkus: Set<string>): ImportPreviewRow {
    const get = (...keys: string[]) => {
      const entries = Object.entries(row);
      for (const key of keys) {
        const found = entries.find(([header]) => header.trim().toLowerCase() === key.toLowerCase());
        if (found) return String(found[1] ?? "").trim();
      }
      return "";
    };
    const prefix = get("PREFIX", "prefix");
    const gtin = get("GTIN (14)", "GTIN", "gtin");
    const batch = get("INTERNAL CODE", "batch", "BATCH");
    const weight = get("WEIGHT", "weight");
    const qtyRaw = get("QTY", "quantity", "case_qty");
    const mrpRaw = get("MRP", "mrp");
    const variant = get("VARIANT", "variant", "variant_code") || "NA";
    const name = get("PRODUCT NAME", "product_name", "name") || "Mr Makhana";
    const fullBarcode = normalizeBarcode(get("FULL BARCODE STRING", "barcode", "barcode_value"));
    const qty = parseQuantityFormat(qtyRaw);
    const mrp = Number(mrpRaw || 0);
    const sku = buildSkuFromMaster(prefix, gtin, batch, weight, qty?.qty ?? 0, qty?.unit ?? "", mrp, variant);
    const messages: string[] = [];
    if (!prefix) messages.push("Missing PREFIX");
    if (!/^\d{8,14}$/.test(gtin)) messages.push("Invalid GTIN");
    if (!batch) messages.push("Missing INTERNAL CODE");
    if (!weight) messages.push("Missing WEIGHT");
    if (!qty) messages.push("Invalid QTY; expected pcs, pc, or p");
    if (!Number.isFinite(mrp)) messages.push("Invalid MRP");
    if (fullBarcode && !normalizeCartonNo(fullBarcode.slice(-5)) && !/X{5}$/i.test(fullBarcode)) messages.push("Example barcode must end with 00001-99999 or XXXXX");
    const template = barcodeTemplate;
    const product: Product = {
      id: uid("product"),
      name,
      category: "Fox Nuts",
      sku,
      gtin,
      prefix,
      flavour: name,
      weight,
      mrp: Number.isFinite(mrp) ? mrp : 0,
      caseQty: qty?.qty ?? 0,
      qtyUnit: (qty?.unit ?? "pc") as Product["qtyUnit"],
      variantCode: variant,
      shelfLifeDays: 180,
      status: "Active",
      template,
      dataOrigin: "real",
    };
    const exampleBatch = batch.replace(/[^A-Za-z0-9]/g, "") || "BATCH1";
    const pattern = buildPattern(product, batch, exampleBatch);
    const duplicateInFile = seenSkus.has(sku);
    if (duplicateInFile) messages.push(`Duplicate SKU in file: ${sku}`);
    seenSkus.add(sku);
    const duplicateExisting = state.products.some((item) => item.sku === sku) || state.barcodePatterns.some((item) => item.sku === sku);
    return {
      rowNumber,
      product,
      pattern,
      status: messages.length ? "error" : duplicateExisting ? "duplicate" : "valid",
      messages: duplicateExisting ? [...messages, `Existing SKU/template will be updated: ${sku}`] : messages,
    };
  }

  async function previewExcel(file: File) {
    if (!user || !can(user, "sensitive")) return;
    const rows = await readImportRows(file);
    const seenSkus = new Set<string>();
    const preview = rows.map((row, index) => parseSkuMasterRow(row, index + 2, seenSkus));
    const errors = preview.flatMap((item) => item.status === "error" ? item.messages.map((message) => `Row ${item.rowNumber}: ${message}`) : []);
    setImportPreview(preview);
    setImportErrors(errors);
    setImportSummary("");
    setImportStep(errors.length ? "Validate" : "Preview");
  }

  function importSkuMaster() {
    if (!user || !can(user, "sensitive")) return;
    const importable = importPreview.filter((item) => item.status !== "error");
    if (!importable.length) {
      setImportSummary("No valid SKU templates to import.");
      setImportStep("Summary");
      return;
    }
    mutate((draft) => {
      importable.forEach(({ product, pattern }) => {
        const existingProduct = draft.products.find((item) => item.sku === product.sku);
        if (existingProduct) {
          Object.assign(existingProduct, { ...product, id: existingProduct.id });
          pattern.productId = existingProduct.id;
        } else {
          draft.products.unshift(product);
        }
        const existingPattern = draft.barcodePatterns.find((item) => item.sku === product.sku);
        if (existingPattern) Object.assign(existingPattern, { ...pattern, id: existingPattern.id, productId: existingProduct?.id ?? product.id });
        else draft.barcodePatterns.unshift(pattern);
      });
    });
    setImportSummary(`${importable.length} SKU/barcode templates imported. 0 cartons created; inventory remains based only on actual carton records.`);
    setImportStep("Summary");
    audit("Excel SKU master import", { reason: `${importable.length} SKU templates imported, ${importErrors.length} rejected. No cartons created.` });
  }

  function addProduct(form: FormData) {
    if (!user || !can(user, "sensitive")) return;
    const product: Product = {
      id: uid("product"),
      name: String(form.get("name")),
      category: String(form.get("category")),
      sku: String(form.get("sku")),
      gtin: String(form.get("gtin")),
      prefix: String(form.get("prefix")),
      flavour: String(form.get("flavour")),
      weight: String(form.get("weight")),
      mrp: Number(form.get("mrp")),
      caseQty: Number(form.get("caseQty")),
      qtyUnit: String(form.get("qtyUnit")) as Product["qtyUnit"],
      variantCode: String(form.get("variantCode")),
      shelfLifeDays: Number(form.get("shelfLifeDays")),
      hsn: String(form.get("hsn")),
      status: String(form.get("status")) as Product["status"],
      template: String(form.get("template") || barcodeTemplate),
      dataOrigin: "real",
    };
    mutate((draft) => {
      draft.products.unshift(product);
      draft.barcodePatterns.unshift(buildPattern(product));
    });
    audit("Product created", { newValue: product.sku });
  }

  function generateBatch(productId: string, batch: string, startNo: number, endNo: number) {
    if (!user || !can(user, "sensitive")) return;
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const start = Math.max(minCartonNo, Math.floor(startNo));
    const end = Math.min(maxCartonNo, Math.floor(endNo));
    if (!batch.trim() || start > end) return;
    const generatedAt = new Date();
    const mfd = generatedAt.toISOString().slice(0, 10);
    const expiryDate = new Date(generatedAt);
    expiryDate.setDate(expiryDate.getDate() + product.shelfLifeDays);
    const expiry = expiryDate.toISOString().slice(0, 10);
    const existing = new Set(state.cartons.map((carton) => carton.barcode));
    const created = Array.from({ length: end - start + 1 }, (_, index) => {
      const cartonNo = String(start + index).padStart(5, "0");
      const barcode = generateBarcode(product, batch, cartonNo);
      if (existing.has(barcode)) return null;
      return {
        id: uid("carton"),
        barcode,
        productId: product.id,
        sku: product.sku,
        gtin: product.gtin,
        flavour: product.flavour,
        weight: product.weight,
        mrp: product.mrp,
        qty: product.caseQty,
        qtyUnit: product.qtyUnit,
        batch,
        mfd,
        expiry,
        cartonNo,
        warehouseId: factoryWarehouseId,
        status: "IN_FACTORY" as Status,
        dataOrigin: "real" as DataOrigin,
      };
    }).filter(Boolean) as Carton[];
    if (!created.length) return;
    mutate((draft) => {
      draft.cartons.push(...created);
      draft.registry.push(...created);
      draft.documents.unshift({
        id: `PBS-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`,
        type: "Production Batch Slip",
        createdAt: now(),
        createdBy: user.id,
        source: "Factory",
        destination: "Factory",
        barcodes: created.map((carton) => carton.barcode),
        dataOrigin: "real",
      });
      draft.documents.unshift({
        id: `BLS-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 2).padStart(3, "0")}`,
        type: "Barcode Label Sheet",
        createdAt: now(),
        createdBy: user.id,
        source: "Factory",
        destination: "Factory",
        barcodes: created.map((carton) => carton.barcode),
        dataOrigin: "real",
      });
    });
    audit("Production batch generated", { newValue: `${batch}: ${created.length} cartons`, reason: `Generated carton range ${String(start).padStart(5, "0")}-${String(end).padStart(5, "0")}.` });
  }

  function approveMismatch(id: string, reason: string) {
    if (!user || !can(user, "sensitive") || !reason.trim()) return;
    mutate((draft) => {
      const item = draft.mismatches.find((match) => match.id === id);
      if (!item) return;
      item.status = "Approved shortage";
      item.approvedBy = user.id;
      item.reason = reason;
      item.missing.forEach((barcode) => {
        const carton = draft.cartons.find((entry) => entry.barcode === barcode);
        if (carton) {
          carton.status = "LOST";
          carton.blockedReason = reason;
        }
      });
      draft.documents.unshift({
        id: `SMR-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`,
        type: "Shortage/Mismatch Report",
        createdAt: now(),
        createdBy: user.id,
        approver: user.id,
        discrepancy: reason,
        barcodes: [...item.missing, ...item.extra],
        dataOrigin: item.dataOrigin,
      });
      draft.documents.unshift({
        id: `IR-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`,
        type: "Investigation Report",
        createdAt: now(),
        createdBy: user.id,
        approver: user.id,
        discrepancy: reason,
        barcodes: [...item.missing, ...item.extra],
        dataOrigin: item.dataOrigin,
      });
    });
    audit("Shortage approved", { documentRef: id, reason });
  }

  function reverseCarton(barcode: string, reason: string) {
    if (!user || !can(user, "sensitive") || !reason.trim()) return;
    mutate((draft) => {
      const carton = draft.cartons.find((item) => item.barcode === barcode);
      if (!carton) return;
      const oldValue = carton.status;
      carton.status = "REVERSED";
      carton.blockedReason = reason;
      const documentRef = `SAA-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(draft.documents.length + 1).padStart(3, "0")}`;
      draft.documents.unshift({
        id: documentRef,
        type: "Stock Adjustment Approval Slip",
        createdAt: now(),
        createdBy: user.id,
        approver: user.id,
        source: warehouseById[carton.warehouseId],
        discrepancy: reason,
        barcodes: [barcode],
        dataOrigin: carton.dataOrigin,
      });
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Carton reversed", barcode, documentRef, oldValue, newValue: "REVERSED", reason });
    });
  }

  function setSystemMode(mode: AppMode) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      draft.settings.mode = mode;
      draft.audit.unshift({
        id: uid("audit"),
        time: now(),
        userId: user.id,
        role: user.role,
        action: `System mode changed to ${mode === "development" ? "Development" : "Production"}`,
        oldValue: state.settings.mode,
        newValue: mode,
        reason: "Admin system setting update",
      });
    });
  }

  function setDemoArchived(archived: boolean, reason: string) {
    if (!user || user.role !== "Admin" || !reason.trim()) return;
    mutate((draft) => {
      draft.products.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.cartons.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.sessions.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.documents.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.mismatches.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.registry.forEach((item) => {
        if (isDemoRecord(item)) item.archived = archived;
      });
      draft.audit.unshift({
        id: uid("audit"),
        time: now(),
        userId: user.id,
        role: user.role,
        action: archived ? "Demo data archived" : "Demo data restored",
        reason,
      });
    });
  }

  function deleteDemoDataPermanently(reason: string) {
    if (!user || user.role !== "Admin" || !reason.trim()) return;
    mutate((draft) => {
      draft.products = draft.products.filter((item) => !isDemoRecord(item));
      draft.cartons = draft.cartons.filter((item) => !isDemoRecord(item));
      draft.sessions = draft.sessions.filter((item) => !isDemoRecord(item));
      draft.documents = draft.documents.filter((item) => !isDemoRecord(item));
      draft.mismatches = draft.mismatches.filter((item) => !isDemoRecord(item));
      draft.registry = draft.registry.filter((item) => !isDemoRecord(item));
      draft.audit.unshift({
        id: uid("audit"),
        time: now(),
        userId: user.id,
        role: user.role,
        action: "Demo data permanently deleted",
        reason,
      });
    });
  }

  function goLive(reason: string) {
    if (!user || user.role !== "Admin" || !reason.trim()) return;
    mutate((draft) => {
      draft.settings.mode = "production";
      draft.settings.goLiveAt = now();
      draft.products.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.cartons.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.sessions.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.documents.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.mismatches.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.registry.forEach((item) => {
        if (isDemoRecord(item)) item.archived = true;
      });
      draft.audit.unshift({
        id: uid("audit"),
        time: now(),
        userId: user.id,
        role: user.role,
        action: "Go Live completed",
        oldValue: "development",
        newValue: "production",
        reason,
      });
    });
  }

  function addMasterRecord(masterKey: MasterKey, form: FormData) {
    if (!user || !hasPermission(state, user, "Settings", "create")) return;
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    if (!name || !code) return;
    mutate((draft) => {
      const list = draft.managementConfig.masters[masterKey] ?? [];
      if (list.some((item) => item.code.toLowerCase() === code.toLowerCase())) return;
      list.unshift(masterRecord(name, code, String(form.get("description") ?? ""), user.name));
      draft.managementConfig.masters[masterKey] = list;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Master data created", newValue: `${masterKey}:${code}` });
    });
  }

  function setMasterStatus(masterKey: MasterKey, id: string, status: MasterStatus) {
    if (!user || !hasPermission(state, user, "Settings", "archive")) return;
    mutate((draft) => {
      const record = draft.managementConfig.masters[masterKey]?.find((item) => item.id === id);
      if (!record) return;
      const oldValue = record.status;
      record.status = status;
      record.archived = status === "Archived";
      record.updatedAt = now();
      record.owner = user.name;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Master data status changed", oldValue, newValue: `${record.code}:${status}` });
    });
  }

  function updateMasterRecord(masterKey: MasterKey, id: string, updates: Partial<Pick<MasterRecord, "name" | "code" | "description">>) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const record = draft.managementConfig.masters[masterKey]?.find((item) => item.id === id);
      if (!record) return;
      const oldValue = `${record.code}:${record.name}`;
      record.name = updates.name?.trim() || record.name;
      record.code = updates.code?.trim().toUpperCase() || record.code;
      record.description = updates.description ?? record.description;
      record.owner = user.name;
      record.updatedAt = now();
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Master data edited", oldValue, newValue: `${masterKey}:${record.code}:${record.name}` });
    });
  }

  function addAdminUser(form: FormData) {
    if (!user || user.role !== "Admin") return;
    const emailValue = String(form.get("email") ?? "").trim().toLowerCase();
    const nameValue = String(form.get("name") ?? "").trim();
    const roleValue = String(form.get("role") ?? "Viewer") as Role;
    const warehouseValue = String(form.get("warehouseId") ?? primaryWarehouseId);
    const passwordValue = String(form.get("password") ?? "Password@123");
    if (!emailValue || !nameValue || state.users.some((item) => item.email.toLowerCase() === emailValue)) return;
    mutate((draft) => {
      const nextUser: User = {
        id: uid("user"),
        name: nameValue,
        email: emailValue,
        password: passwordValue,
        role: roleValue,
        warehouseId: warehouseValue,
        warehouseAccess: [warehouseValue],
        disabled: false,
        archived: false,
      };
      draft.users.unshift(nextUser);
      draft.managementConfig.managedUsers = draft.users;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "User created", newValue: `${nextUser.email}:${nextUser.role}` });
    });
  }

  function updateAdminUser(id: string, form: FormData) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const target = draft.users.find((item) => item.id === id);
      if (!target) return;
      const oldValue = `${target.email}:${target.role}:${target.warehouseId}`;
      target.name = String(form.get("name") ?? target.name).trim() || target.name;
      target.email = String(form.get("email") ?? target.email).trim().toLowerCase() || target.email;
      target.role = String(form.get("role") ?? target.role) as Role;
      target.warehouseId = String(form.get("warehouseId") ?? target.warehouseId);
      target.warehouseAccess = [target.warehouseId];
      target.disabled = form.get("disabled") === "on";
      draft.managementConfig.managedUsers = draft.users;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "User edited", oldValue, newValue: `${target.email}:${target.role}:${target.warehouseId}` });
    });
  }

  function archiveAdminUser(id: string) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const target = draft.users.find((item) => item.id === id);
      if (!target) return;
      if (target.role === "Admin" && draft.users.filter((item) => item.role === "Admin" && !item.archived && !item.disabled).length <= 1) return;
      target.archived = true;
      target.disabled = true;
      draft.managementConfig.managedUsers = draft.users;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "User archived", newValue: target.email, reason: "Archive used instead of hard delete" });
    });
  }

  function resetAdminPassword(id: string) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const target = draft.users.find((item) => item.id === id);
      if (!target) return;
      const oldValue = target.password;
      target.password = `Reset@${new Date().toISOString().slice(5, 10).replace("-", "")}`;
      target.passwordResetAt = now();
      draft.managementConfig.managedUsers = draft.users;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "User password reset", oldValue: oldValue ? "set" : "empty", newValue: `${target.email}:temporary password issued` });
    });
  }

  function addLocation(form: FormData) {
    if (!user || user.role !== "Admin") return;
    const nameValue = String(form.get("name") ?? "").trim();
    const typeValue = String(form.get("type") ?? "warehouse") as WarehouseRecord["type"];
    if (!nameValue) return;
    mutate((draft) => {
      if (draft.warehouses.some((item) => item.name.toLowerCase() === nameValue.toLowerCase())) return;
      const location: WarehouseRecord = { id: normalizeSkuPart(nameValue).toLowerCase(), name: nameValue, type: typeValue, archived: false };
      draft.warehouses.push(location);
      draft.managementConfig.managedWarehouses = draft.warehouses;
      draft.managementConfig.masters.locations.unshift(masterRecord(location.name, `LOC-${normalizeSkuPart(location.name).slice(0, 16)}`, `${location.type} location`, user.name));
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Location created", newValue: `${location.name}:${location.type}` });
    });
  }

  function updateLocation(id: string, form: FormData) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const location = draft.warehouses.find((item) => item.id === id);
      if (!location) return;
      const oldValue = `${location.name}:${location.type}`;
      location.name = String(form.get("name") ?? location.name).trim() || location.name;
      location.type = String(form.get("type") ?? location.type) as WarehouseRecord["type"];
      draft.managementConfig.managedWarehouses = draft.warehouses;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Location edited", oldValue, newValue: `${location.name}:${location.type}` });
    });
  }

  function archiveLocation(id: string) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const location = draft.warehouses.find((item) => item.id === id);
      if (!location) return;
      const hasInventory = draft.cartons.some((carton) => carton.warehouseId === id && !carton.archived);
      const hasUsers = draft.users.some((item) => item.warehouseId === id && !item.archived);
      const hasDocuments = draft.documents.some((doc) => doc.source === location.name || doc.destination === location.name);
      if (hasInventory || hasUsers || hasDocuments) {
        draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Location archive blocked", newValue: location.name, reason: "Location has inventory, users, or transaction history" });
        return;
      }
      location.archived = true;
      draft.managementConfig.managedWarehouses = draft.warehouses;
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Location archived", newValue: location.name, reason: "Archive used instead of hard delete" });
    });
  }

  function updateProductAdmin(productId: string, form: FormData) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const product = draft.products.find((item) => item.id === productId);
      if (!product) return;
      const oldValue = product.sku;
      product.name = String(form.get("name") ?? product.name).trim() || product.name;
      product.sku = String(form.get("sku") ?? product.sku).trim() || product.sku;
      product.gtin = String(form.get("gtin") ?? product.gtin).trim() || product.gtin;
      product.status = String(form.get("status") ?? product.status) as Product["status"];
      product.template = String(form.get("template") ?? product.template).trim() || product.template;
      const pattern = draft.barcodePatterns.find((item) => item.productId === product.id);
      if (pattern) Object.assign(pattern, buildPattern(product), { id: pattern.id, productId: product.id });
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Product edited", oldValue, newValue: product.sku });
    });
  }

  function archiveProductAdmin(productId: string) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      const product = draft.products.find((item) => item.id === productId);
      if (!product) return;
      product.archived = true;
      product.status = "Blocked";
      draft.barcodePatterns.filter((item) => item.productId === product.id).forEach((pattern) => {
        pattern.archived = true;
      });
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Product archived", newValue: product.sku, reason: "Archive used instead of hard delete; carton history preserved" });
    });
  }

  function togglePermission(role: Role, module: string, action: PermissionAction) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      let grant = draft.managementConfig.permissions.find((item) => item.role === role && item.module === module);
      if (!grant) {
        grant = { role, module, actions: [] };
        draft.managementConfig.permissions.push(grant);
      }
      grant.actions = grant.actions.includes(action) ? grant.actions.filter((item) => item !== action) : [...grant.actions, action];
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "Permission updated", newValue: `${role}:${module}:${action}` });
    });
  }

  function updateManagementSettings(form: FormData) {
    if (!user || user.role !== "Admin") return;
    mutate((draft) => {
      draft.managementConfig.settings = {
        ...draft.managementConfig.settings,
        defaultFactory: String(form.get("defaultFactory") || draft.managementConfig.settings.defaultFactory),
        defaultWarehouse: String(form.get("defaultWarehouse") || draft.managementConfig.settings.defaultWarehouse),
        stockRule: String(form.get("stockRule")) === "FIFO" ? "FIFO" : "FEFO",
        nearExpiryWarningDays: Number(form.get("nearExpiryWarningDays") || 45),
        autoFocusScanner: form.get("autoFocusScanner") === "on",
        scannerSounds: form.get("scannerSounds") === "on",
        autoRegisterCartonOnFirstScan: form.get("autoRegisterCartonOnFirstScan") === "on",
        twoLevelApprovals: form.get("twoLevelApprovals") === "on",
        barcodeFormatDefault: String(form.get("barcodeFormatDefault") || barcodeTemplate),
        cartonNumberLength: Number(form.get("cartonNumberLength") || 5),
        documentPrefixes: {
          ...draft.managementConfig.settings.documentPrefixes,
          dispatch: String(form.get("dispatchPrefix") || "DSP"),
          receiving: String(form.get("receivingPrefix") || "RCV"),
          transfer: String(form.get("transferPrefix") || "TRF"),
          batch: String(form.get("batchPrefix") || "BAT"),
        },
      };
      draft.audit.unshift({ id: uid("audit"), time: now(), userId: user.id, role: user.role, action: "System settings updated", newValue: "Management settings" });
    });
  }

  if (backendStatus === "loading") {
    return (
      <main className="ds-login text-[var(--text-strong)]">
        <Card className="w-full max-w-md">
          <div className="inline-flex items-center gap-2 rounded-xl bg-[var(--blue-50)] px-3 py-2 text-sm font-bold text-[var(--blue-700)]">
            <ShieldCheck size={18} /> Mr Makhana WMS
          </div>
          <h1 className="mt-6 text-2xl font-bold">Loading Supabase data</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{backendMessage}</p>
        </Card>
      </main>
    );
  }

  if (backendStatus === "error" && !state.users.length) {
    return (
      <main className="ds-login text-[var(--text-strong)]">
        <Card className="w-full max-w-md border-rose-200">
          <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            <AlertTriangle size={18} /> Supabase unavailable
          </div>
          <h1 className="mt-6 text-2xl font-bold">Database load failed</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">{backendMessage}</p>
        </Card>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="ds-login text-[var(--text-strong)]">
        <section className="ds-login__grid">
          <div className="ds-login__hero">
            <div>
              <Image src="/logo-makhana-white.png" alt="Mr Makhana" width={190} height={72} className="h-14 w-auto" priority />
              <div className="ds-eyebrow mt-8">Warehouse Operating System</div>
              <h1 className="ds-display">Carton-level control for scanning, dispatch, receiving and audit.</h1>
              <p className="ds-muted-on-brand mt-4">
                Development Mode is seeded with role-based users, warehouses, cartons, dispatches, mismatch cases, reports, and document slips. Production Mode hides demo operational data for cutover.
              </p>
            </div>
            <div className="ds-login__metrics">
              {[["Tracking", "Carton"], ["Inventory rule", "Scan only"], ["Roles", "5"]].map(([label, value]) => (
                <div key={label} className="ds-glass">
                  <div className="ds-glass__label">{label}</div>
                  <div className="ds-glass__value">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <Card>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                login();
              }}
            >
            <h2 className="m-0 text-[22px] font-extrabold text-[var(--text-strong)]">Sign in</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{state.settings.mode === "development" ? "Use one of the seeded internal test accounts." : "Production Mode is active. Test account shortcuts are hidden."}</p>
            <div className="mt-6 grid gap-4">
              <TextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
              <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              {loginError ? <div className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{loginError}</div> : null}
              <Button type="submit">
                <Lock size={18} /> Sign in
              </Button>
            </div>
            {state.settings.mode === "development" ? <div className="mt-6 space-y-2 text-xs text-[var(--text-muted)]">
              <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-faint)]">Seeded accounts</div>
              {state.users.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="flex w-full items-center justify-between rounded-[10px] border border-[var(--border-subtle)] bg-white px-3 py-2.5 text-left transition hover:bg-[var(--blue-50)]"
                  onClick={() => {
                    setEmail(item.email);
                    setPassword(item.password);
                  }}
                >
                  <span>
                    <span className="block text-sm font-bold text-[var(--text-strong)]">{item.name}</span>
                    <span className="text-[11px]">{item.email}</span>
                  </span>
                  <Tag tone="brand">{item.role}</Tag>
                </button>
              ))}
            </div> : null}
            </form>
          </Card>
        </section>
      </main>
    );
  }

  const navGroups = [
    {
      title: "Operations",
      items: [
        { label: "Dashboard", icon: BarChart3, show: hasPermission(state, user, "Dashboard", "view") },
        { label: "Dispatches", icon: Truck, show: hasPermission(state, user, "Dispatches", "view") },
        { label: "Scan", icon: QrCode, show: hasPermission(state, user, "Scan", "view") },
        { label: "Inventory", icon: Boxes, show: hasPermission(state, user, "Inventory", "view") },
        { label: "Receiving", icon: PackageCheck, show: hasPermission(state, user, "Receiving", "view") },
        { label: "Shipments", icon: Send, show: hasPermission(state, user, "Shipments", "view") },
      ],
    },
    {
      title: "Management",
      items: [
        { label: "Factory Management", icon: Building2, show: hasPermission(state, user, "Factory Management", "view") },
        { label: "Warehouse Management", icon: Warehouse, show: hasPermission(state, user, "Warehouse Management", "view") },
        { label: "Products", icon: Archive, show: hasPermission(state, user, "Products", "view") },
        { label: "Customers", icon: Users, show: hasPermission(state, user, "Customers", "view") },
        { label: "Users", icon: UserCog, show: hasPermission(state, user, "Users", "view") },
        { label: "Locations", icon: MapPin, show: hasPermission(state, user, "Locations", "view") },
      ],
    },
    {
      title: "System",
      items: [
        { label: "Admin Panel", icon: ShieldCheck, show: user.role === "Admin" },
        { label: "Import Data", icon: Upload, show: hasPermission(state, user, "Import Data", "view") },
        { label: "Documents", icon: FileText, show: hasPermission(state, user, "Documents", "view") },
        { label: "Reports", icon: BarChart3, show: hasPermission(state, user, "Reports", "view") },
        { label: "Audit Logs", icon: History, show: hasPermission(state, user, "Audit Logs", "view") },
        { label: "Demo / Production Mode", icon: Settings, show: hasPermission(state, user, "Demo / Production Mode", "view") },
        { label: "Checklist", icon: ClipboardCheck, show: hasPermission(state, user, "Checklist", "view") },
        { label: "Settings", icon: Database, show: hasPermission(state, user, "Settings", "view") },
      ],
    },
  ];

  const visibleCartons = operationalCartons.filter((carton) => {
    if (user.role === "Admin" || user.role === "Accountant") return true;
    return carton.warehouseId === user.warehouseId || carton.status.includes("IN_TRANSIT");
  });
  const selectedCarton = visibleCartons.find((carton) => carton.barcode === selectedCartonBarcode);
  const inventoryBatches = Array.from(new Set(visibleCartons.map((carton) => carton.batch))).sort();
  const inventoryStatuses = Array.from(new Set(visibleCartons.map((carton) => carton.status))).sort();
  const inventoryProducts = Array.from(new Set(visibleCartons.map((carton) => carton.sku))).sort();
  const inventoryFilteredCartons = visibleCartons.filter((carton) => {
    const product = productById[carton.productId];
    const haystack = [carton.barcode, carton.sku, carton.gtin, carton.flavour, carton.batch, product?.name].join(" ").toLowerCase();
    const daysToExpiry = daysFrom(carton.expiry);
    if (inventoryQuery && !haystack.includes(inventoryQuery.toLowerCase())) return false;
    if (inventoryWarehouse && carton.warehouseId !== inventoryWarehouse) return false;
    if (inventoryBatch && carton.batch !== inventoryBatch) return false;
    if (inventoryStatus && carton.status !== inventoryStatus) return false;
    if (inventoryProduct && carton.sku !== inventoryProduct) return false;
    if (inventoryExpiry === "near" && !(daysToExpiry >= 0 && daysToExpiry <= 45)) return false;
    if (inventoryExpiry === "expired" && daysToExpiry >= 0) return false;
    return true;
  });
  const inventoryRows = Array.from(
    inventoryFilteredCartons
      .reduce((map, carton) => {
        const key = [carton.productId, carton.sku, carton.gtin, carton.batch, carton.warehouseId, carton.status].join("|");
        const existing = map.get(key);
        if (existing) {
          existing.cartons += 1;
          existing.totalUnits += carton.qty;
          if (carton.mfd > existing.lastMovement) existing.lastMovement = carton.mfd;
          existing.sampleBarcode = existing.sampleBarcode || carton.barcode;
        } else {
          map.set(key, {
            key,
            product: productById[carton.productId]?.name ?? carton.flavour,
            sku: carton.sku,
            gtin: carton.gtin,
            batch: carton.batch,
            warehouse: warehouseById[carton.warehouseId] ?? carton.warehouseId,
            cartons: 1,
            unitsPerCarton: carton.qty,
            totalUnits: carton.qty,
            status: carton.status,
            lastMovement: carton.mfd,
            sampleBarcode: carton.barcode,
          });
        }
        return map;
      }, new Map<string, InventoryAggregateRow>())
      .values(),
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const todaysDispatches = operationalDocuments.filter((doc) => doc.type.includes("Dispatch") && doc.createdAt.slice(0, 10) === todayKey).length;
  const pendingReceiptCartons = sourceSessions.receiving.reduce((sum, item) => sum + item.scanned.length, 0) + sourceSessions.transferIn.reduce((sum, item) => sum + item.scanned.length, 0);
  const factoryCartons = visibleCartons.filter((carton) => carton.warehouseId === factoryWarehouseId || carton.status === "IN_FACTORY");
  const warehouseCartons = visibleCartons.filter((carton) => state.warehouses.find((warehouse) => warehouse.id === carton.warehouseId)?.type === "warehouse");
  const customerDispatches = operationalDocuments.filter((doc) => doc.type.includes("Customer"));
  const receivingDocuments = operationalDocuments.filter((doc) => doc.type.includes("Receive") || doc.type.includes("Receiving"));
  const dispatchDocuments = operationalDocuments.filter((doc) => doc.type.includes("Dispatch"));
  const navItems = navGroups.flatMap((group) => group.items);
  const currentPage = navItems.find((item) => item.label === view) ?? navItems[0];
  const pageSubtitles: Record<string, string> = {
    Dashboard: "A clear operating picture for today’s warehouse activity.",
    Dispatches: "Factory and customer dispatch work in one place.",
    Scan: "Large-button scanning for warehouse floor workflows.",
    Inventory: "Live carton-level stock across all accessible locations.",
    Receiving: "Inbound warehouse receiving and missing-carton follow-up.",
    Shipments: "Customer dispatches, outbound cartons, and shipment documents.",
    "Factory Management": "Factory stock, production batches, and dispatch readiness.",
    "Warehouse Management": "Warehouse stock, receiving, transfers, and customer dispatch.",
    Products: "Product master, barcode patterns, and carton range generation.",
    Customers: "Customer dispatch visibility derived from shipment records.",
    Users: "Role-based users and warehouse assignments.",
    Locations: "Factory, warehouse, and transit location analytics.",
    "Admin Panel": "Admin control centre for users, roles, masters, locations, products, settings, and audit safety.",
    "Import Data": "Excel SKU master import with validation and duplicate checks.",
    Documents: "Dispatch, receiving, transfer, and batch slips.",
    Reports: "Operational reports generated from Supabase-backed data.",
    "Audit Logs": "Every sensitive action and carton movement audit trail.",
    "Demo / Production Mode": "UAT demo controls and production cutover tools.",
    Checklist: "Pre-launch readiness for Supabase, workflows, PDFs, and scanning.",
    Settings: "System configuration, mode, and database connection status.",
  };
  const searchTerm = search.trim().toLowerCase();
  const searchMatches = searchTerm
    ? operationalCartons.filter((carton) => carton.barcode.toLowerCase().includes(searchTerm) || carton.sku.toLowerCase().includes(searchTerm) || carton.batch.toLowerCase().includes(searchTerm))
    : [];
  const globalSearchResults = searchTerm
    ? [
        ...searchMatches.map((carton) => ({ type: "Barcode / Carton", title: carton.barcode, detail: `${carton.sku} / ${carton.batch} / ${warehouseById[carton.warehouseId]} / ${carton.status}` })),
        ...operationalProducts.filter((item) => [item.sku, item.name, item.flavour, item.gtin].join(" ").toLowerCase().includes(searchTerm)).map((item) => ({ type: "Product / SKU", title: item.sku, detail: `${item.name} / ${item.flavour} / ${item.weight}` })),
        ...state.users.filter((item) => [item.name, item.email, item.role].join(" ").toLowerCase().includes(searchTerm)).map((item) => ({ type: "User", title: item.name, detail: `${item.role} / ${item.email}` })),
        ...state.warehouses.filter((item) => [item.name, item.type].join(" ").toLowerCase().includes(searchTerm)).map((item) => ({ type: "Warehouse", title: item.name, detail: item.type })),
        ...operationalDocuments.filter((item) => [item.id, item.type, item.source, item.destination, item.vehicle, item.driver, item.lr].join(" ").toLowerCase().includes(searchTerm)).map((item) => ({ type: "Document", title: item.id, detail: `${item.type} / ${item.source ?? "-"} -> ${item.destination ?? "-"}` })),
        ...operationalMismatches.filter((item) => [item.id, item.status, item.reason].join(" ").toLowerCase().includes(searchTerm)).map((item) => ({ type: "Investigation Case", title: item.id, detail: `${item.status} / Missing ${item.missing.length}` })),
      ].slice(0, 12)
    : [];
  return (
    <main className="os-shell">
      <aside className="os-sidebar">
        <div className="os-brand">
          <span className="os-brand__mark">
            <Image src="/logo-makhana-white.png" alt="" width={96} height={36} className="h-7 w-auto" />
          </span>
          <div className="min-w-0">
            <div className="os-brand__title">Mr Makhana</div>
            <div className="os-brand__sub">Warehouse OS</div>
          </div>
        </div>

        <nav className="os-nav">
          {navGroups.map((group) => (
            <div key={group.title} className="os-nav__group">
              <div className="os-nav__heading">{group.title}</div>
              <div className="os-nav__items">
                {group.items.filter((item) => item.show).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button key={item.label} onClick={() => setView(item.label)} className={`os-nav__item ${view === item.label ? "os-nav__item--active" : ""}`}>
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="os-user-card">
          <div className="os-user-card__name">{user.name}</div>
          <div className="os-user-card__meta">{user.role}</div>
          <div className="os-user-card__meta">{warehouseById[user.warehouseId]}</div>
          <div className="mt-3">
            <StatusBadge tone={state.settings.mode === "development" ? "amber" : "teal"}>{state.settings.mode === "development" ? "Development" : "Production"}</StatusBadge>
          </div>
        </div>
      </aside>

      <section className="os-main">
        <header className="os-topbar">
          <button className="os-mobile-menu" aria-label="Menu"><Menu size={20} /></button>
          <div className="min-w-0">
            <div className="os-page-kicker">{currentPage ? currentPage.label : view}</div>
            <h1 className="os-page-title">{view}</h1>
            <p className="os-page-subtitle">{pageSubtitles[view] ?? "Warehouse operating tools connected to Supabase."}</p>
          </div>
          <div className="os-topbar__tools">
            <div className="os-search">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search barcode, SKU, or batch" className="mm-input mm-input--mono" />
            </div>
            <Tag tone={backendStatus === "error" ? "neutral" : backendStatus === "saving" ? "brand" : "accent"}>{backendMessage}</Tag>
            <Button variant="ghost" size="sm" onClick={logout}><LogOut size={18} /> Logout</Button>
          </div>
        </header>

        <nav className="os-mobile-nav">
          {navGroups[0].items.filter((item) => item.show).slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} onClick={() => setView(item.label)} className={view === item.label ? "os-mobile-nav__active" : ""} aria-label={item.label}>
                <Icon size={22} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

      <section className="os-content">
        {globalSearchResults.length ? (
          <Card className="mb-5 border-[var(--blue-100)]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Global search results</h2>
              <Button variant="ghost" onClick={() => setSearch("")}>Clear</Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {globalSearchResults.map((item) => (
                <div key={`${item.type}-${item.title}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--slate-50)] p-3">
                  <Tag tone="brand">{item.type}</Tag>
                  <div className="mt-2 truncate font-bold text-[var(--text-strong)]">{item.title}</div>
                  <div className="mt-1 truncate text-sm text-[var(--text-muted)]">{item.detail}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {view === "Dashboard" ? (
          <section className="ds-screen">
            <div className="os-kpi-grid">
              <Stat label="Today’s dispatches" value={todaysDispatches} tone="warning" />
              <Stat label="Cartons scanned" value={operationalSessions.reduce((sum, item) => sum + item.scanned.length, 0)} tone="brand" />
              <Stat label="Active products" value={operationalProducts.length} tone="accent" />
              <Stat label="Active users" value={state.users.length} />
            </div>
            <RoleWorkspace
              user={user}
              metrics={metrics}
              pendingApprovals={operationalMismatches.filter((item) => item.status === "Open").length}
              draftSessions={operationalSessions.filter((item) => !item.finalized).length}
              setView={setView}
            />

            <div className="ds-two-col">
              <Card title="Inventory Health" action={<Button variant="secondary" size="sm" onClick={() => setView("Inventory")}><Boxes size={16} /> View inventory</Button>}>
                <div className="ds-card-grid">
                  <AlertPanel title="Low stock" items={operationalProducts.map((product) => `${product.sku}: ${visibleCartons.filter((carton) => carton.productId === product.id && !lockedStatuses.includes(carton.status)).length} cartons`)} />
                  <AlertPanel title="Near-expiry" items={visibleCartons.filter((carton) => daysFrom(carton.expiry) <= 45).slice(0, 6).map((carton) => `${carton.sku} ${carton.cartonNo}: ${daysFrom(carton.expiry)} days`)} />
                  <AlertPanel title="Pending receipt" items={operationalSessions.filter((item) => item.type === "Factory Dispatch" && item.finalized).slice(0, 4).map((item) => `${item.id}: ${item.scanned.length} cartons dispatched`)} />
                  <AlertPanel title="Duplicate barcodes" items={findDuplicates(operationalCartons.map((carton) => carton.barcode)).map((barcode) => barcode)} />
                </div>
              </Card>
              <Card title="Recent activity">
                <div className="ds-feed">
                  {state.audit.slice(0, 8).map((item) => (
                    <div key={item.id} className="ds-feed__item">
                      <div className="ds-feed__title">{item.action}</div>
                      <div className="ds-feed__meta">{item.barcode ?? item.documentRef ?? item.newValue ?? "System"} / {state.users.find((entry) => entry.id === item.userId)?.name ?? item.role}</div>
                      <div className="mt-1 text-[11px] text-[var(--text-faint)]">{new Date(item.time).toLocaleString()}</div>
                    </div>
                  ))}
                  {!state.audit.length ? <EmptyState text="No audit activity yet." compact /> : null}
                </div>
              </Card>
            </div>

            <div className="ds-two-col">
              <Card title="Location Analytics">
                <WarehouseBars warehouses={state.warehouses.map((warehouse) => ({ label: warehouse.name, count: visibleCartons.filter((carton) => carton.warehouseId === warehouse.id).length }))} total={Math.max(visibleCartons.length, 1)} />
              </Card>
              <Card title="Operating Status">
                <div className="movement-chart">
                  <ChartBar label="Factory" value={visibleCartons.filter((carton) => carton.status === "IN_FACTORY").length} total={Math.max(visibleCartons.length, 1)} tone="teal" />
                  <ChartBar label="Transit" value={metrics.inTransit} total={Math.max(visibleCartons.length, 1)} tone="blue" />
                  <ChartBar label="Customer" value={visibleCartons.filter((carton) => carton.status === "DISPATCHED_TO_CUSTOMER").length} total={Math.max(visibleCartons.length, 1)} tone="slate" />
                  <ChartBar label="Exceptions" value={metrics.blocked + metrics.missing} total={Math.max(visibleCartons.length, 1)} tone="red" />
                </div>
              </Card>
            </div>

            <Card title="Inventory" action={<Tag mono>{visibleCartons.length} cartons shown</Tag>} pad={false}>
              <InventoryTable rows={visibleCartons.slice(0, 80)} warehouseById={warehouseById} />
            </Card>
          </section>
        ) : null}

        {view === "Dispatches" ? (
          <WorkflowLanding
            tone="orange"
            title="Factory Dispatch"
            subtitle="Select source, destination, batch/SKU, then scan cartons into a packing list."
            icon={<Truck size={26} />}
            stats={[
              ["Factory dispatches", dispatchDocuments.filter((doc) => doc.type.includes("Factory")).length],
              ["In transit", metrics.inTransit],
              ["Dispatch slips", dispatchDocuments.length],
              ["Draft scans", operationalSessions.filter((item) => !item.finalized && item.type === "Factory Dispatch").length],
            ]}
            steps={["Select source factory/warehouse", "Select destination warehouse", "Select batch/SKU", "Scan cartons", "Review packing list", "Finalize dispatch slip"]}
            primaryLabel="Start factory dispatch"
            onPrimary={() => startSession("Factory Dispatch")}
            documents={dispatchDocuments}
            onReprint={(doc) => reprintDocument(doc, "Workflow document download")}
          />
        ) : null}

        {view === "Inventory" ? (
          <InventoryWorkbench
            cartons={visibleCartons}
            filteredCartons={inventoryFilteredCartons}
            rows={inventoryRows}
            warehouses={state.warehouses}
            warehouseById={warehouseById}
            productById={productById}
            metrics={metrics}
            pendingReceiptCartons={pendingReceiptCartons}
            query={inventoryQuery}
            onQuery={setInventoryQuery}
            warehouseFilter={inventoryWarehouse}
            onWarehouseFilter={setInventoryWarehouse}
            batchFilter={inventoryBatch}
            onBatchFilter={setInventoryBatch}
            statusFilter={inventoryStatus}
            onStatusFilter={setInventoryStatus}
            productFilter={inventoryProduct}
            onProductFilter={setInventoryProduct}
            expiryFilter={inventoryExpiry}
            onExpiryFilter={setInventoryExpiry}
            batches={inventoryBatches}
            statuses={inventoryStatuses}
            products={inventoryProducts}
            selectedCarton={selectedCarton}
            documents={operationalDocuments}
            audit={state.audit}
            canReverse={hasPermission(state, user, "Inventory", "approve")}
            onSelectCarton={setSelectedCartonBarcode}
            onCloseDrawer={() => setSelectedCartonBarcode("")}
            onScan={() => setView("Scan")}
            onCreateBatch={() => setView("Products")}
            onPrintLabels={() => setView("Documents")}
            onExport={() => exportCsv("inventory-snapshot", inventoryFilteredCartons.map((carton) => ({ barcode: carton.barcode, sku: carton.sku, gtin: carton.gtin, batch: carton.batch, warehouse: warehouseById[carton.warehouseId], cartons: 1, units: carton.qty, status: carton.status, expiry: carton.expiry })))}
            onReverse={reverseCarton}
          />
        ) : null}

        {view === "Receiving" ? (
          <WorkflowLanding
            tone="green"
            title="Warehouse Receiving"
            subtitle="Mirror dispatch: load an incoming dispatch, scan received cartons, compare expected versus received."
            icon={<PackageCheck size={26} />}
            stats={[
              ["Expected incoming", pendingReceiptCartons],
              ["Open dispatches", sourceSessions.receiving.length],
              ["Mismatch cases", operationalMismatches.filter((item) => item.status !== "Closed").length],
              ["Receiving slips", receivingDocuments.length],
            ]}
            steps={["Select incoming dispatch", "Show expected cartons", "Scan received cartons", "Compare expected vs received", "Finalize or create investigation"]}
            primaryLabel="Receive dispatch"
            secondaryLabel="Receive transfer"
            onPrimary={() => startSession("Warehouse Receive")}
            onSecondary={() => startSession("Transfer In")}
            documents={receivingDocuments}
            onReprint={(doc) => reprintDocument(doc, "Workflow document download")}
          />
        ) : null}

        {view === "Shipments" ? (
          <WorkflowLanding
            tone="purple"
            title="Customer Dispatch"
            subtitle="Customer-led outbound scanning with packing list, delivery challan, and dispatch slip generation."
            icon={<Send size={26} />}
            stats={[
              ["Customer dispatches", customerDispatches.length],
              ["Dispatched cartons", visibleCartons.filter((carton) => carton.status === "DISPATCHED_TO_CUSTOMER").length],
              ["Customers served", new Set(operationalCartons.map((carton) => carton.customer).filter(Boolean)).size],
              ["Delivery challans", operationalDocuments.filter((doc) => doc.type.includes("Challan")).length],
            ]}
            steps={["Select customer", "Select source warehouse", "Select batch/SKU", "Scan cartons", "Review packing list", "Generate challan and slip"]}
            primaryLabel="Start customer dispatch"
            secondaryLabel="View shipment slips"
            onPrimary={() => startSession("Customer Dispatch")}
            onSecondary={() => setView("Documents")}
            documents={customerDispatches}
            onReprint={(doc) => reprintDocument(doc, "Workflow document download")}
          />
        ) : null}

        {view === "Scan" ? (
          <OperationalScanWorkspace
            session={session}
            scanInput={scanInput}
            scanRef={scanRef}
            scanMessage={scanMessage}
            cameraOn={cameraOn}
            fullscreen={scanFullscreen}
            canScan={can(user, "scan")}
            cartons={operationalCartons}
            products={operationalProducts}
            warehouses={state.warehouses}
            warehouseById={warehouseById}
            productById={productById}
            sourceSessions={sourceSessions}
            drafts={operationalSessions.filter((item) => !item.finalized)}
            mismatches={operationalMismatches}
            onStart={startSession}
            onResume={resumeDraft}
            onSessionChange={setSession}
            onSourceSessionChange={updateSourceSession}
            onScanInput={setScanInput}
            onScan={handleScan}
            onUndo={undoLastScan}
            onSaveDraft={saveDraft}
            onFinalize={finalizeSession}
            onToggleCamera={() => setCameraOn((value) => !value)}
            onToggleFullscreen={() => setScanFullscreen((value) => !value)}
            onExportPacking={() => session ? exportCsv(`${session.type.toLowerCase().replaceAll(" ", "-")}-packing-list`, session.scanned.map((barcode) => {
              const carton = operationalCartons.find((item) => item.barcode === barcode);
              return { barcode, sku: carton?.sku, batch: carton?.batch, warehouse: carton ? warehouseById[carton.warehouseId] : "", status: carton?.status };
            })) : undefined}
          />
        ) : null}

        {view === "Products" ? (
          <ProductsPanel products={operationalProducts} cartons={operationalCartons} patterns={state.barcodePatterns} onAddProduct={addProduct} onGenerateBatch={generateBatch} />
        ) : null}

        {view === "Factory Management" ? (
          <section className="ds-screen">
            <div className="os-kpi-grid">
              <Stat label="Factory stock" value={factoryCartons.length} tone="accent" />
              <Stat label="Production batches" value={new Set(factoryCartons.map((carton) => carton.batch)).size} tone="warning" />
              <Stat label="Ready to dispatch" value={factoryCartons.filter((carton) => carton.status === "IN_FACTORY").length} tone="brand" />
              <Stat label="Batch slips" value={operationalDocuments.filter((doc) => doc.type.includes("Production Batch")).length} />
            </div>
            <div className="os-action-grid">
              <button className="os-action-card os-action-card--orange" onClick={() => startSession("Factory Dispatch")}><Truck size={26} /> Dispatch to Warehouse</button>
              <button className="os-action-card os-action-card--blue" onClick={() => setView("Products")}><Archive size={26} /> Production Batches</button>
              <button className="os-action-card os-action-card--green" onClick={() => setView("Documents")}><FileText size={26} /> Batch Slips</button>
            </div>
            <Card title="Active Factory Cartons" pad={false}>
              <InventoryTable rows={factoryCartons} warehouseById={warehouseById} />
            </Card>
          </section>
        ) : null}

        {view === "Warehouse Management" ? (
          <section className="ds-screen">
            <div className="os-kpi-grid">
              <Stat label="Warehouse stock" value={warehouseCartons.length} tone="accent" />
              <Stat label="Receiving slips" value={receivingDocuments.length} tone="accent" />
              <Stat label="Transfers" value={operationalDocuments.filter((doc) => doc.type.includes("Transfer")).length} tone="brand" />
              <Stat label="Customer dispatches" value={customerDispatches.length} tone="warning" />
            </div>
            <div className="os-action-grid">
              <button className="os-action-card os-action-card--green" onClick={() => startSession("Warehouse Receive")}><PackageCheck size={26} /> Receiving</button>
              <button className="os-action-card os-action-card--blue" onClick={() => startSession("Transfer Out")}><ArrowRightLeft size={26} /> Transfer Out</button>
              <button className="os-action-card os-action-card--purple" onClick={() => startSession("Customer Dispatch")}><Send size={26} /> Customer Dispatch</button>
            </div>
            <Card title="Location-wise Cartons">
              <WarehouseBars warehouses={state.warehouses.filter((warehouse) => warehouse.type === "warehouse").map((warehouse) => ({ label: warehouse.name, count: visibleCartons.filter((carton) => carton.warehouseId === warehouse.id).length }))} total={Math.max(warehouseCartons.length, 1)} />
            </Card>
          </section>
        ) : null}

        {view === "Customers" ? (
          <section className="ds-screen">
            <div className="os-kpi-grid">
              <Stat label="Customers served" value={new Set(operationalCartons.map((carton) => carton.customer).filter(Boolean)).size} tone="accent" />
              <Stat label="Customer shipments" value={customerDispatches.length} tone="brand" />
              <Stat label="Dispatched cartons" value={visibleCartons.filter((carton) => carton.status === "DISPATCHED_TO_CUSTOMER").length} tone="warning" />
              <Stat label="Delivered cartons" value={visibleCartons.filter((carton) => carton.status === "DELIVERED").length} />
            </div>
            <Card title="Customer Dispatch Records">
              <div className="ds-doc-grid">
                {customerDispatches.map((doc) => <DocumentCard key={doc.id} doc={doc} onReprint={reprintDocument} />)}
                {!customerDispatches.length ? <EmptyState text="No customer dispatch records yet." /> : null}
              </div>
            </Card>
            <MasterDataCenter title="Customer Master" masterKey="customers" records={state.managementConfig.masters.customers} canManage={hasPermission(state, user, "Customers", "create")} onAdd={addMasterRecord} onEdit={updateMasterRecord} onStatus={setMasterStatus} />
          </section>
        ) : null}

        {view === "Users" ? (
          <AdminUsersPanel users={state.users} warehouses={state.warehouses} audit={state.audit} canManage={user.role === "Admin"} onAdd={addAdminUser} onUpdate={updateAdminUser} onArchive={archiveAdminUser} onResetPassword={resetAdminPassword} />
        ) : null}

        {view === "Locations" ? (
          <AdminLocationsPanel warehouses={state.warehouses} cartons={visibleCartons} users={state.users} documents={state.documents} canManage={user.role === "Admin"} onAdd={addLocation} onUpdate={updateLocation} onArchive={archiveLocation} />
        ) : null}

        {view === "Admin Panel" ? (
          <AdminPanel
            users={state.users}
            warehouses={state.warehouses}
            products={state.products}
            cartons={state.cartons}
            documents={state.documents}
            audit={state.audit}
            config={state.managementConfig}
            canManage={user.role === "Admin"}
            onAddUser={addAdminUser}
            onUpdateUser={updateAdminUser}
            onArchiveUser={archiveAdminUser}
            onResetPassword={resetAdminPassword}
            onAddLocation={addLocation}
            onUpdateLocation={updateLocation}
            onArchiveLocation={archiveLocation}
            onAddMaster={addMasterRecord}
            onEditMaster={updateMasterRecord}
            onStatusMaster={setMasterStatus}
            onTogglePermission={togglePermission}
            onSaveSettings={updateManagementSettings}
            onAddProduct={addProduct}
            onUpdateProduct={updateProductAdmin}
            onArchiveProduct={archiveProductAdmin}
          />
        ) : null}

        {view === "Import Data" ? (
          <section className="grid gap-5">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Excel Import Wizard</h2>
                  <p className="mt-2 text-sm text-slate-600">Imports Product Master, SKU Master, Barcode Template, and Barcode Pattern Registry. It never creates inventory cartons from theoretical ranges.</p>
                </div>
                <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{importStep}</span>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                {(["Upload", "Preview", "Validate", "Import", "Summary"] as const).map((step) => (
                  <div key={step} className={`rounded-xl border p-3 text-center text-sm font-bold ${step === importStep ? "border-[var(--blue-100)] bg-[var(--blue-50)] text-[var(--blue-700)]" : "border-[var(--border-subtle)] bg-white text-[var(--text-muted)]"}`}>{step}</div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                <input className="mm-input w-full p-1.5" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && previewExcel(event.target.files[0])} />
                <Button disabled={!importPreview.length || importErrors.length > 0} onClick={() => setImportStep("Import")}>Validate</Button>
                <Button disabled={!importPreview.length || importErrors.length > 0} onClick={importSkuMaster}><Upload size={18} /> Import</Button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Stat label="Rows previewed" value={importPreview.length} />
                <Stat label="Valid new" value={importPreview.filter((item) => item.status === "valid").length} tone="emerald" />
                <Stat label="Duplicates update" value={importPreview.filter((item) => item.status === "duplicate").length} tone="amber" />
                <Stat label="Errors" value={importPreview.filter((item) => item.status === "error").length} tone={importErrors.length ? "rose" : "slate"} />
              </div>
              {importSummary ? <div className="mt-4 rounded-xl bg-[var(--teal-50)] p-3 text-sm font-bold text-[var(--teal-700)]">{importSummary}</div> : null}
            </Card>
            <div className="grid gap-5 xl:grid-cols-[1.4fr_0.6fr]">
              <Card>
                <h2 className="text-lg font-bold">Preview and validation</h2>
                <div className="mt-4 overflow-auto">
                  <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        {["Row", "Status", "SKU", "Pattern", "Range", "Actual cartons", "Message"].map((header) => <th key={header} className="p-3 text-xs font-extrabold uppercase tracking-[0.04em] text-[var(--text-muted)]">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(0, 80).map((item) => (
                        <tr key={`${item.rowNumber}-${item.product.sku}`} className="border-b border-slate-100">
                          <td className="p-3">{item.rowNumber}</td>
                          <td className="p-3 font-bold">{item.status}</td>
                          <td className="p-3 font-mono text-xs">{item.product.sku}</td>
                          <td className="max-w-[320px] truncate p-3 font-mono text-xs">{item.pattern.exampleBarcode.replace("BATCH1", item.pattern.batchPattern)}</td>
                          <td className="p-3">{item.pattern.cartonRangeStart}-{item.pattern.cartonRangeEnd}</td>
                          <td className="p-3">0 imported</td>
                          <td className="max-w-[320px] truncate p-3">{item.messages.join("; ") || "Ready"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!importPreview.length ? <EmptyState text="Upload an Excel or CSV file to preview SKU templates." /> : null}
                </div>
              </Card>
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">Error report</h2>
                  <Button variant="secondary" onClick={() => exportCsv("sku-master-import-errors", importErrors.map((error) => ({ error })))}>
                    <Download size={18} /> CSV
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  {importErrors.length ? importErrors.map((error) => <div key={error} className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>) : <EmptyState text="No blocking validation errors." />}
                </div>
              </Card>
            </div>
          </section>
        ) : null}

        {view === "Documents" ? (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Documents and slips</h2>
              <Button variant="secondary" onClick={() => exportCsv("documents", state.documents.map((doc) => ({ id: doc.id, type: doc.type, createdAt: doc.createdAt, cartons: doc.barcodes.length, discrepancy: doc.discrepancy })))}>
                <Download size={18} /> CSV
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {operationalDocuments.map((doc) => (
                <DocumentCard key={doc.id} doc={doc} onReprint={reprintDocument} />
              ))}
            </div>
          </Card>
        ) : null}

        {view === "Reports" ? (
          <section className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {state.warehouses.map((warehouse) => <Stat key={warehouse.id} label={warehouse.name} value={visibleCartons.filter((carton) => carton.warehouseId === warehouse.id).length} />)}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <ReportTable title="Inventory by SKU, batch, expiry, status" rows={visibleCartons.map((carton) => ({ barcode: carton.barcode, sku: carton.sku, batch: carton.batch, expiry: carton.expiry, warehouse: warehouseById[carton.warehouseId], status: carton.status }))} />
              <Card>
                <h2 className="text-lg font-bold">Shortage and investigation cases</h2>
                <div className="mt-4 space-y-3">
                  {operationalMismatches.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold">{item.id}</div>
                        <StatusBadge tone="amber">{item.status}</StatusBadge>
                      </div>
                      <div className="mt-2 text-sm text-slate-600">Missing {item.missing.length} / Extra {item.extra.length} / Duplicate {item.duplicates.length}</div>
                      {can(user, "sensitive") && item.status === "Open" ? <MismatchApproval onApprove={(reason) => approveMismatch(item.id, reason)} /> : null}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </section>
        ) : null}

        {view === "Audit Logs" ? (
          <ReportTable title="User activity and audit logs" rows={state.audit.map((item) => ({ time: item.time, user: state.users.find((entry) => entry.id === item.userId)?.name, role: item.role, action: item.action, barcode: item.barcode, document: item.documentRef, old: item.oldValue, new: item.newValue, reason: item.reason }))} />
        ) : null}

        {view === "Demo / Production Mode" ? (
          <DemoDataManager
            mode={state.settings.mode}
            goLiveAt={state.settings.goLiveAt}
            demoCounts={demoCounts}
            demoProducts={state.products.filter(isDemoRecord)}
            demoCartons={state.cartons.filter(isDemoRecord)}
            demoDocuments={state.documents.filter(isDemoRecord)}
            onSetMode={setSystemMode}
            onArchive={(reason) => setDemoArchived(true, reason)}
            onRestore={(reason) => setDemoArchived(false, reason)}
            onDelete={deleteDemoDataPermanently}
            onGoLive={goLive}
          />
        ) : null}

        {view === "Checklist" ? (
          <PreLaunchChecklist
            supabaseStatus={supabaseStatus}
            mode={state.settings.mode}
            hasRealProducts={state.products.some((item) => item.dataOrigin === "real" && !item.archived)}
            hasRealCartons={state.cartons.some((item) => item.dataOrigin === "real" && !item.archived)}
            hasDispatch={operationalDocuments.some((item) => item.type.includes("Dispatch"))}
            hasReceiving={operationalDocuments.some((item) => item.type.includes("Receiving"))}
            hasTransfer={operationalDocuments.some((item) => item.type.includes("Transfer"))}
            hasReports={operationalDocuments.some((item) => item.type.includes("Report"))}
            hasPdfDocuments={operationalDocuments.length > 0}
            hasBarcodeData={operationalCartons.length > 0}
            hasAuditLogs={state.audit.length > 0}
          />
        ) : null}

        {view === "Settings" ? (
          <section className="ds-screen">
            <div className="os-kpi-grid">
              <Stat label="Supabase" value={supabaseStatus} tone={supabaseStatus === "connected" ? "accent" : "danger"} />
              <Stat label="Mode" value={state.settings.mode} tone={state.settings.mode === "production" ? "brand" : "warning"} />
              <Stat label="Warehouses" value={state.warehouses.length} />
              <Stat label="Audit logs" value={state.audit.length} />
            </div>
            <Card title="System Settings">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-[var(--slate-50)] p-4">
                  <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--text-muted)]">Project reference</div>
                  <div className="mt-2 font-mono text-sm font-bold text-[var(--text-strong)]">{state.settings.supabaseProjectRef ?? "Not configured"}</div>
                </div>
                <div className="rounded-xl bg-[var(--slate-50)] p-4">
                  <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-[var(--text-muted)]">Cutover status</div>
                  <div className="mt-2 text-sm font-bold text-[var(--text-strong)]">{state.settings.goLiveAt ? `Go Live completed ${new Date(state.settings.goLiveAt).toLocaleString()}` : "UAT mode active"}</div>
                </div>
              </div>
            </Card>
            <SystemSettingsPanel settings={state.managementConfig.settings} warehouses={state.warehouses} onSave={updateManagementSettings} />
            <PermissionMatrix permissions={state.managementConfig.permissions} onToggle={togglePermission} />
            <MasterDataSuite config={state.managementConfig} canManage={user.role === "Admin"} onAdd={addMasterRecord} onEdit={updateMasterRecord} onStatus={setMasterStatus} />
            <AdminSafetyPanel products={state.products} warehouses={state.warehouses} cartons={state.cartons} documents={state.documents} users={state.users} />
          </section>
        ) : null}
      </section>
      </section>
    </main>
  );
}

function RoleWorkspace({
  user,
  metrics,
  pendingApprovals,
  draftSessions,
  setView,
}: {
  user: User;
  metrics: { cartons: number; units: number; inTransit: number; blocked: number; nearExpiry: number; missing: number };
  pendingApprovals: number;
  draftSessions: number;
  setView: (view: string) => void;
}) {
  const roleActions: Record<Role, { label: string; view: string; tone: string }[]> = {
    Admin: [
      { label: "User & Permissions", view: "Settings", tone: "os-action-card--blue" },
      { label: "Master Data", view: "Settings", tone: "os-action-card--green" },
      { label: "Import / Export", view: "Import Data", tone: "os-action-card--orange" },
    ],
    Accountant: [
      { label: "Approval Queue", view: "Reports", tone: "os-action-card--orange" },
      { label: "Financial Dispatch", view: "Reports", tone: "os-action-card--blue" },
      { label: "Audit Logs", view: "Audit Logs", tone: "os-action-card--green" },
    ],
    "Warehouse Manager": [
      { label: "Inventory Overview", view: "Inventory", tone: "os-action-card--green" },
      { label: "Dispatch / Receive", view: "Scan", tone: "os-action-card--orange" },
      { label: "Expiry & Damage", view: "Reports", tone: "os-action-card--purple" },
    ],
    Operator: [
      { label: "Start Scanning", view: "Scan", tone: "os-action-card--orange" },
      { label: "Resume Drafts", view: "Scan", tone: "os-action-card--blue" },
      { label: "Find Inventory", view: "Inventory", tone: "os-action-card--green" },
    ],
    Viewer: [
      { label: "Inventory Visibility", view: "Inventory", tone: "os-action-card--green" },
      { label: "Dispatch History", view: "Dispatches", tone: "os-action-card--blue" },
      { label: "KPI Reports", view: "Reports", tone: "os-action-card--purple" },
    ],
  };
  return (
    <Card title={`${user.role} Workspace`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="os-action-grid">
          {roleActions[user.role].map((item) => (
            <button key={item.label} className={`os-action-card ${item.tone}`} onClick={() => setView(item.view)}>
              <ArrowRightLeft size={24} /> {item.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Pending approvals" value={pendingApprovals} tone={pendingApprovals ? "warning" : "accent"} />
          <Stat label="Draft sessions" value={draftSessions} tone={draftSessions ? "brand" : "slate"} />
          <Stat label="Exceptions" value={metrics.blocked + metrics.missing} tone={metrics.blocked + metrics.missing ? "danger" : "accent"} />
          <Stat label="Near expiry" value={metrics.nearExpiry} tone={metrics.nearExpiry ? "warning" : "slate"} />
        </div>
      </div>
    </Card>
  );
}

function AdminPanel({
  users,
  warehouses,
  products,
  cartons,
  documents,
  audit,
  config,
  canManage,
  onAddUser,
  onUpdateUser,
  onArchiveUser,
  onResetPassword,
  onAddLocation,
  onUpdateLocation,
  onArchiveLocation,
  onAddMaster,
  onEditMaster,
  onStatusMaster,
  onTogglePermission,
  onSaveSettings,
  onAddProduct,
  onUpdateProduct,
  onArchiveProduct,
}: {
  users: User[];
  warehouses: WarehouseRecord[];
  products: Product[];
  cartons: Carton[];
  documents: DocumentRecord[];
  audit: AuditLog[];
  config: ManagementConfig;
  canManage: boolean;
  onAddUser: (form: FormData) => void;
  onUpdateUser: (id: string, form: FormData) => void;
  onArchiveUser: (id: string) => void;
  onResetPassword: (id: string) => void;
  onAddLocation: (form: FormData) => void;
  onUpdateLocation: (id: string, form: FormData) => void;
  onArchiveLocation: (id: string) => void;
  onAddMaster: (masterKey: MasterKey, form: FormData) => void;
  onEditMaster: (masterKey: MasterKey, id: string, updates: Partial<Pick<MasterRecord, "name" | "code" | "description">>) => void;
  onStatusMaster: (masterKey: MasterKey, id: string, status: MasterStatus) => void;
  onTogglePermission: (role: Role, module: string, action: PermissionAction) => void;
  onSaveSettings: (form: FormData) => void;
  onAddProduct: (form: FormData) => void;
  onUpdateProduct: (id: string, form: FormData) => void;
  onArchiveProduct: (id: string) => void;
}) {
  return (
    <section className="admin-panel">
      <div className="ops-toolbar">
        <div>
          <h2>Admin Control Centre</h2>
          <p>Create, edit, archive, configure, and audit the WMS without developer intervention.</p>
        </div>
        <Tag tone="brand">Archive-first safety</Tag>
      </div>
      <div className="ops-kpi-row">
        <Stat label="Users" value={users.filter((item) => !item.archived).length} />
        <Stat label="Locations" value={warehouses.filter((item) => !item.archived).length} tone="accent" />
        <Stat label="Products / SKUs" value={products.filter((item) => !item.archived).length} tone="brand" />
        <Stat label="Audit events" value={audit.length} tone="warning" />
      </div>
      <AdminUsersPanel users={users} warehouses={warehouses} audit={audit} canManage={canManage} onAdd={onAddUser} onUpdate={onUpdateUser} onArchive={onArchiveUser} onResetPassword={onResetPassword} />
      <AdminLocationsPanel warehouses={warehouses} cartons={cartons} users={users} documents={documents} canManage={canManage} onAdd={onAddLocation} onUpdate={onUpdateLocation} onArchive={onArchiveLocation} />
      <AdminProductsPanel products={products} cartons={cartons} patterns={[]} canManage={canManage} onAdd={onAddProduct} onUpdate={onUpdateProduct} onArchive={onArchiveProduct} />
      <PermissionMatrix permissions={config.permissions} onToggle={onTogglePermission} />
      <SystemSettingsPanel settings={config.settings} warehouses={warehouses} onSave={onSaveSettings} />
      <MasterDataSuite config={config} canManage={canManage} onAdd={onAddMaster} onEdit={onEditMaster} onStatus={onStatusMaster} />
      <AdminSafetyPanel products={products} warehouses={warehouses} cartons={cartons} documents={documents} users={users} />
    </section>
  );
}

function AdminUsersPanel({ users, warehouses, audit, canManage, onAdd, onUpdate, onArchive, onResetPassword }: { users: User[]; warehouses: WarehouseRecord[]; audit: AuditLog[]; canManage: boolean; onAdd: (form: FormData) => void; onUpdate: (id: string, form: FormData) => void; onArchive: (id: string) => void; onResetPassword: (id: string) => void }) {
  return (
    <Card title="User Management" pad={false}>
      {canManage ? (
        <form
          className="admin-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd(new FormData(event.currentTarget));
            event.currentTarget.reset();
          }}
        >
          <TextField name="name" label="Name" required />
          <TextField name="email" label="Email" type="email" required />
          <TextField name="password" label="Temporary password" defaultValue="Password@123" required />
          <SelectField name="role" label="Role">{(["Admin", "Accountant", "Warehouse Manager", "Operator", "Viewer"] as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}</SelectField>
          <SelectField name="warehouseId" label="Warehouse access">{warehouses.filter((item) => !item.archived).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</SelectField>
          <Button type="submit" className="self-end"><UserCog size={18} /> Add user</Button>
        </form>
      ) : null}
      <div className="ds-table-wrap">
        <table className="ds-table min-w-[1080px]">
          <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Warehouse</th><th>Status</th><th>Activity</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((item) => (
              <tr key={item.id}>
                <td>
                  <form id={`user-${item.id}`} className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); onUpdate(item.id, new FormData(event.currentTarget)); }}>
                    <input className="admin-cell-input" name="name" defaultValue={item.name} disabled={!canManage || item.archived} />
                  </form>
                </td>
                <td><input form={`user-${item.id}`} className="admin-cell-input ds-mono" name="email" defaultValue={item.email} disabled={!canManage || item.archived} /></td>
                <td>
                  <select form={`user-${item.id}`} name="role" defaultValue={item.role} className="admin-cell-input" disabled={!canManage || item.archived}>
                    {(["Admin", "Accountant", "Warehouse Manager", "Operator", "Viewer"] as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </td>
                <td>
                  <select form={`user-${item.id}`} name="warehouseId" defaultValue={item.warehouseId} className="admin-cell-input" disabled={!canManage || item.archived}>
                    {warehouses.filter((warehouse) => !warehouse.archived).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                  </select>
                </td>
                <td>
                  <label className="admin-check"><input form={`user-${item.id}`} name="disabled" type="checkbox" defaultChecked={item.disabled} disabled={!canManage || item.archived} /> Disabled</label>
                  {item.archived ? <StatusBadge tone="slate">Archived</StatusBadge> : null}
                </td>
                <td className="ds-mono">{audit.filter((entry) => entry.userId === item.id).length}</td>
                <td>
                  <div className="admin-row-actions">
                    <Button size="sm" type="submit" form={`user-${item.id}`} disabled={!canManage || item.archived}>Save</Button>
                    <Button size="sm" variant="secondary" disabled={!canManage || item.archived} onClick={() => onResetPassword(item.id)}>Reset</Button>
                    <Button size="sm" variant="danger" disabled={!canManage || item.archived} onClick={() => onArchive(item.id)}>Archive</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AdminLocationsPanel({ warehouses, cartons, users, documents, canManage, onAdd, onUpdate, onArchive }: { warehouses: WarehouseRecord[]; cartons: Carton[]; users: User[]; documents: DocumentRecord[]; canManage: boolean; onAdd: (form: FormData) => void; onUpdate: (id: string, form: FormData) => void; onArchive: (id: string) => void }) {
  return (
    <Card title="Factory, Warehouse & Location Management" pad={false}>
      {canManage ? (
        <form className="admin-create-form" onSubmit={(event) => { event.preventDefault(); onAdd(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
          <TextField name="name" label="Location name" required />
          <SelectField name="type" label="Location type"><option value="factory">Factory</option><option value="warehouse">Warehouse</option><option value="transit">Transit</option><option value="damage-hold">Damage-hold</option><option value="virtual">Virtual</option></SelectField>
          <Button type="submit" className="self-end"><MapPin size={18} /> Add location</Button>
        </form>
      ) : null}
      <div className="ds-table-wrap">
        <table className="ds-table min-w-[980px]">
          <thead><tr><th>Name</th><th>Type</th><th>Cartons</th><th>Users</th><th>History</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {warehouses.map((warehouse) => {
              const cartonCount = cartons.filter((carton) => carton.warehouseId === warehouse.id).length;
              const userCount = users.filter((item) => item.warehouseId === warehouse.id).length;
              const historyCount = documents.filter((doc) => doc.source === warehouse.name || doc.destination === warehouse.name).length;
              return (
                <tr key={warehouse.id}>
                  <td>
                    <form id={`loc-${warehouse.id}`} onSubmit={(event) => { event.preventDefault(); onUpdate(warehouse.id, new FormData(event.currentTarget)); }}>
                      <input className="admin-cell-input" name="name" defaultValue={warehouse.name} disabled={!canManage || warehouse.archived} />
                    </form>
                  </td>
                  <td>
                    <select form={`loc-${warehouse.id}`} name="type" defaultValue={warehouse.type} className="admin-cell-input" disabled={!canManage || warehouse.archived}>
                      <option value="factory">Factory</option><option value="warehouse">Warehouse</option><option value="transit">Transit</option><option value="damage-hold">Damage-hold</option><option value="virtual">Virtual</option>
                    </select>
                  </td>
                  <td className="ds-mono">{cartonCount}</td>
                  <td className="ds-mono">{userCount}</td>
                  <td className="ds-mono">{historyCount}</td>
                  <td>{warehouse.archived ? <StatusBadge tone="slate">Archived</StatusBadge> : <StatusBadge tone="teal">Active</StatusBadge>}</td>
                  <td>
                    <div className="admin-row-actions">
                      <Button size="sm" type="submit" form={`loc-${warehouse.id}`} disabled={!canManage || warehouse.archived}>Save</Button>
                      <Button size="sm" variant="danger" disabled={!canManage || warehouse.archived || cartonCount > 0 || userCount > 0 || historyCount > 0} onClick={() => onArchive(warehouse.id)}>Archive</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AdminProductsPanel({ products, cartons, canManage, onAdd, onUpdate, onArchive }: { products: Product[]; cartons: Carton[]; patterns: BarcodePattern[]; canManage: boolean; onAdd: (form: FormData) => void; onUpdate: (id: string, form: FormData) => void; onArchive: (id: string) => void }) {
  return (
    <Card title="Product, SKU & Barcode Template Management" pad={false}>
      {canManage ? (
        <form className="admin-create-form admin-create-form--wide" onSubmit={(event) => { event.preventDefault(); onAdd(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
          <TextField name="name" label="Product" required defaultValue="Mr Makhana Roasted Makhana" />
          <TextField name="flavour" label="Flavour" required />
          <TextField name="category" label="Category" required defaultValue="Fox Nuts" />
          <TextField name="sku" label="SKU" required />
          <TextField name="gtin" label="GTIN" required />
          <TextField name="prefix" label="Prefix" required defaultValue="MM" />
          <TextField name="weight" label="Weight" required placeholder="70G" />
          <TextField name="mrp" label="MRP" type="number" required />
          <TextField name="caseQty" label="Case qty" type="number" required />
          <SelectField name="qtyUnit" label="Unit"><option value="pcs">pcs</option><option value="pc">pc</option><option value="p">p</option></SelectField>
          <TextField name="variantCode" label="Variant" required />
          <TextField name="shelfLifeDays" label="Shelf life" type="number" required defaultValue={180} />
          <TextField name="hsn" label="HSN" />
          <SelectField name="status" label="Status"><option value="Active">Active</option><option value="Blocked">Blocked</option></SelectField>
          <TextField name="template" label="Barcode template" required defaultValue={barcodeTemplate} className="md:col-span-2" mono />
          <Button type="submit" className="self-end"><Archive size={18} /> Create SKU</Button>
        </form>
      ) : null}
      <div className="ds-table-wrap">
        <table className="ds-table min-w-[1180px]">
          <thead><tr><th>Product</th><th>SKU</th><th>GTIN</th><th>Status</th><th>Cartons</th><th>Barcode Template</th><th>Actions</th></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <form id={`product-${product.id}`} onSubmit={(event) => { event.preventDefault(); onUpdate(product.id, new FormData(event.currentTarget)); }}>
                    <input className="admin-cell-input" name="name" defaultValue={product.name} disabled={!canManage || product.archived} />
                  </form>
                </td>
                <td><input form={`product-${product.id}`} className="admin-cell-input ds-mono" name="sku" defaultValue={product.sku} disabled={!canManage || product.archived} /></td>
                <td><input form={`product-${product.id}`} className="admin-cell-input ds-mono" name="gtin" defaultValue={product.gtin} disabled={!canManage || product.archived} /></td>
                <td>
                  <select form={`product-${product.id}`} name="status" defaultValue={product.status} className="admin-cell-input" disabled={!canManage || product.archived}>
                    <option value="Active">Active</option><option value="Blocked">Blocked</option>
                  </select>
                  {product.archived ? <StatusBadge tone="slate">Archived</StatusBadge> : null}
                </td>
                <td className="ds-mono">{cartons.filter((carton) => carton.productId === product.id).length}</td>
                <td><input form={`product-${product.id}`} className="admin-cell-input ds-mono min-w-[360px]" name="template" defaultValue={product.template} disabled={!canManage || product.archived} /></td>
                <td>
                  <div className="admin-row-actions">
                    <Button size="sm" type="submit" form={`product-${product.id}`} disabled={!canManage || product.archived}>Save</Button>
                    <Button size="sm" variant="danger" disabled={!canManage || product.archived} onClick={() => onArchive(product.id)}>Archive</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MasterDataCenter({
  title,
  masterKey,
  records,
  canManage,
  onAdd,
  onEdit,
  onStatus,
}: {
  title: string;
  masterKey: MasterKey;
  records: MasterRecord[];
  canManage: boolean;
  onAdd: (masterKey: MasterKey, form: FormData) => void;
  onEdit?: (masterKey: MasterKey, id: string, updates: Partial<Pick<MasterRecord, "name" | "code" | "description">>) => void;
  onStatus: (masterKey: MasterKey, id: string, status: MasterStatus) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = records.filter((item) => [item.name, item.code, item.description].join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <Card title={title}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_2fr]">
        <TextField label="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
        {canManage ? (
          <form
            className="grid gap-2 md:grid-cols-[1fr_0.8fr_1.4fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onAdd(masterKey, new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <TextField name="name" label="Name" required />
            <TextField name="code" label="Code" required />
            <TextField name="description" label="Description" />
            <Button type="submit" className="self-end">Create</Button>
          </form>
        ) : null}
      </div>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead><tr><th>Name</th><th>Code</th><th>Status</th><th>Description</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((record) => (
              <tr key={record.id}>
                <td>{record.name}</td>
                <td className="ds-mono">{record.code}</td>
                <td><StatusBadge tone={record.status === "Active" ? "teal" : record.status === "Inactive" ? "amber" : "slate"}>{record.status}</StatusBadge></td>
                <td>{record.description}</td>
                <td className="ds-mono">{new Date(record.updatedAt).toLocaleDateString()}</td>
                <td>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canManage || !onEdit}
                      onClick={() => {
                        const name = window.prompt("Name", record.name);
                        if (name === null) return;
                        const code = window.prompt("Code", record.code);
                        if (code === null) return;
                        const description = window.prompt("Description", record.description ?? "");
                        if (description === null) return;
                        onEdit?.(masterKey, record.id, { name, code, description });
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!canManage || record.status === "Active"} onClick={() => onStatus(masterKey, record.id, "Active")}>Activate</Button>
                    <Button size="sm" variant="secondary" disabled={!canManage || record.status === "Inactive"} onClick={() => onStatus(masterKey, record.id, "Inactive")}>Deactivate</Button>
                    <Button size="sm" variant="danger" disabled={!canManage || record.status === "Archived"} onClick={() => onStatus(masterKey, record.id, "Archived")}>Archive</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length ? <EmptyState text="No records match this search." /> : null}
      </div>
    </Card>
  );
}

function MasterDataSuite({ config, canManage, onAdd, onEdit, onStatus }: { config: ManagementConfig; canManage: boolean; onAdd: (masterKey: MasterKey, form: FormData) => void; onEdit: (masterKey: MasterKey, id: string, updates: Partial<Pick<MasterRecord, "name" | "code" | "description">>) => void; onStatus: (masterKey: MasterKey, id: string, status: MasterStatus) => void }) {
  const masters: { key: MasterKey; title: string }[] = [
    { key: "roles", title: "Roles" },
    { key: "locations", title: "Locations" },
    { key: "customers", title: "Customers" },
    { key: "skus", title: "SKUs" },
    { key: "barcodeTemplates", title: "Barcode Templates" },
    { key: "batches", title: "Batches" },
    { key: "transporters", title: "Transporters" },
    { key: "vehicles", title: "Vehicles" },
    { key: "drivers", title: "Drivers" },
    { key: "documentNumbering", title: "Document Numbering" },
    { key: "approvalRules", title: "Approval Rules" },
    { key: "approvalReasons", title: "Approval Reasons" },
    { key: "adjustmentReasons", title: "Adjustment Reasons" },
    { key: "damageReasons", title: "Damage Reasons" },
    { key: "numberingSeries", title: "Numbering / Document Series" },
  ];
  return (
    <section className="grid gap-5">
      {masters.map((item) => (
        <MasterDataCenter key={item.key} title={item.title} masterKey={item.key} records={config.masters[item.key]} canManage={canManage} onAdd={onAdd} onEdit={onEdit} onStatus={onStatus} />
      ))}
    </section>
  );
}

function PermissionMatrix({ permissions, onToggle }: { permissions: PermissionGrant[]; onToggle: (role: Role, module: string, action: PermissionAction) => void }) {
  const roles: Role[] = ["Admin", "Accountant", "Warehouse Manager", "Operator", "Viewer"];
  return (
    <Card title="Role & Permission Management" pad={false}>
      <div className="ds-table-wrap">
        <table className="ds-table min-w-[1120px]">
          <thead><tr><th>Role</th><th>Module</th>{permissionActions.map((action) => <th key={action}>{action}</th>)}</tr></thead>
          <tbody>
            {roles.flatMap((role) => permissionModules.map((module) => {
              const grant = permissions.find((item) => item.role === role && item.module === module);
              return (
                <tr key={`${role}-${module}`}>
                  <td><Tag tone="brand">{role}</Tag></td>
                  <td>{module}</td>
                  {permissionActions.map((action) => (
                    <td key={action}>
                      <input type="checkbox" checked={grant?.actions.includes(action) ?? false} onChange={() => onToggle(role, module, action)} disabled={role === "Admin" && action === "view"} />
                    </td>
                  ))}
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SystemSettingsPanel({ settings, warehouses, onSave }: { settings: ManagementSettings; warehouses: WarehouseRecord[]; onSave: (form: FormData) => void }) {
  return (
    <Card title="Configurable System Settings">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(new FormData(event.currentTarget));
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField name="defaultFactory" label="Default factory" defaultValue={settings.defaultFactory}>{warehouses.filter((item) => item.type === "factory").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</SelectField>
          <SelectField name="defaultWarehouse" label="Default warehouse" defaultValue={settings.defaultWarehouse}>{warehouses.filter((item) => item.type === "warehouse").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</SelectField>
          <SelectField name="stockRule" label="Stock issue rule" defaultValue={settings.stockRule}><option value="FEFO">FEFO</option><option value="FIFO">FIFO</option></SelectField>
          <TextField name="nearExpiryWarningDays" label="Near-expiry warning days" type="number" defaultValue={settings.nearExpiryWarningDays} />
          <TextField name="cartonNumberLength" label="Carton number length" type="number" defaultValue={settings.cartonNumberLength} />
          <TextField name="dispatchPrefix" label="Dispatch prefix" defaultValue={settings.documentPrefixes.dispatch} />
          <TextField name="receivingPrefix" label="Receiving prefix" defaultValue={settings.documentPrefixes.receiving} />
          <TextField name="transferPrefix" label="Transfer prefix" defaultValue={settings.documentPrefixes.transfer} />
          <TextField name="batchPrefix" label="Batch prefix" defaultValue={settings.documentPrefixes.batch} />
        </div>
        <TextField name="barcodeFormatDefault" label="Barcode format default" defaultValue={settings.barcodeFormatDefault} mono />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["autoFocusScanner", "Auto-focus scanner", settings.autoFocusScanner],
            ["scannerSounds", "Scanner sounds", settings.scannerSounds],
            ["autoRegisterCartonOnFirstScan", "Auto-register carton on first scan", settings.autoRegisterCartonOnFirstScan],
            ["twoLevelApprovals", "Two-level approval rules", settings.twoLevelApprovals],
          ].map(([name, label, checked]) => (
            <label key={String(name)} className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--slate-50)] p-3 text-sm font-bold">
              <input type="checkbox" name={String(name)} defaultChecked={Boolean(checked)} /> {label}
            </label>
          ))}
        </div>
        <Button type="submit" className="w-fit"><Settings size={18} /> Save settings</Button>
      </form>
    </Card>
  );
}

function AdminSafetyPanel({ products, warehouses, cartons, documents, users }: { products: Product[]; warehouses: WarehouseRecord[]; cartons: Carton[]; documents: DocumentRecord[]; users: User[] }) {
  const checks = [
    { label: "Last Admin protected", ok: users.filter((item) => item.role === "Admin").length > 1, detail: "Do not archive/delete the final Admin account." },
    { label: "Warehouses with inventory protected", ok: warehouses.every((warehouse) => cartons.filter((carton) => carton.warehouseId === warehouse.id).length === 0) === false, detail: "Warehouses with cartons must be archived only after stock is moved." },
    { label: "Products with carton history protected", ok: products.some((product) => cartons.some((carton) => carton.productId === product.id)), detail: "Products with transactions are archive-only." },
    { label: "Customers with dispatch history protected", ok: documents.some((doc) => doc.type.includes("Customer")), detail: "Customers with dispatch history should not be hard-deleted." },
  ];
  return (
    <Card title="Admin Safety Guardrails">
      <div className="grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div key={check.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--slate-50)] p-4">
            <div className="flex items-center gap-2 font-bold text-[var(--text-strong)]"><ShieldCheck size={18} className="text-[var(--blue-600)]" /> {check.label}</div>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{check.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WarehouseBars({ warehouses, total }: { warehouses: { label: string; count: number }[]; total: number }) {
  return (
    <div className="warehouse-bars">
      {warehouses.map((warehouse) => (
        <div key={warehouse.label} className="warehouse-bar-row">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-[var(--text-strong)]">{warehouse.label}</span>
            <span className="font-mono text-sm font-bold text-[var(--text-muted)]">{warehouse.count}</span>
          </div>
          <div className="warehouse-bar-track">
            <span className="warehouse-bar-fill" style={{ width: `${Math.max(4, (warehouse.count / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkflowLanding({
  tone,
  title,
  subtitle,
  icon,
  stats,
  steps,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  documents,
  onReprint,
}: {
  tone: "orange" | "green" | "blue" | "purple";
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  stats: Array<[string, number]>;
  steps: string[];
  primaryLabel: string;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  documents: DocumentRecord[];
  onReprint: (doc: DocumentRecord) => void;
}) {
  return (
    <section className="ops-page">
      <div className={`ops-hero ops-hero--${tone}`}>
        <div className="ops-hero__icon">{icon}</div>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ops-hero__actions">
          {secondaryLabel && onSecondary ? <Button variant="secondary" onClick={onSecondary}>{secondaryLabel}</Button> : null}
          <Button variant="accent" onClick={onPrimary}>{primaryLabel}</Button>
        </div>
      </div>
      <div className="ops-kpi-row">
        {stats.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
      </div>
      <div className="ops-split">
        <Card title="Workflow steps">
          <div className="ops-step-list">
            {steps.map((step, index) => (
              <div className="ops-step" key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent documents">
          <div className="ds-doc-grid">
            {documents.slice(0, 8).map((doc) => <DocumentCard key={doc.id} doc={doc} onReprint={onReprint} />)}
            {!documents.length ? <EmptyState text="No workflow documents yet." /> : null}
          </div>
        </Card>
      </div>
    </section>
  );
}

function InventoryWorkbench({
  cartons,
  filteredCartons,
  rows,
  warehouses,
  warehouseById,
  productById,
  metrics,
  pendingReceiptCartons,
  query,
  onQuery,
  warehouseFilter,
  onWarehouseFilter,
  batchFilter,
  onBatchFilter,
  statusFilter,
  onStatusFilter,
  productFilter,
  onProductFilter,
  expiryFilter,
  onExpiryFilter,
  batches,
  statuses,
  products,
  selectedCarton,
  documents,
  audit,
  canReverse,
  onSelectCarton,
  onCloseDrawer,
  onScan,
  onCreateBatch,
  onPrintLabels,
  onExport,
  onReverse,
}: {
  cartons: Carton[];
  filteredCartons: Carton[];
  rows: InventoryAggregateRow[];
  warehouses: WarehouseRecord[];
  warehouseById: Record<string, string>;
  productById: Record<string, Product>;
  metrics: { cartons: number; units: number; inTransit: number; blocked: number; nearExpiry: number; missing: number };
  pendingReceiptCartons: number;
  query: string;
  onQuery: (value: string) => void;
  warehouseFilter: string;
  onWarehouseFilter: (value: string) => void;
  batchFilter: string;
  onBatchFilter: (value: string) => void;
  statusFilter: string;
  onStatusFilter: (value: string) => void;
  productFilter: string;
  onProductFilter: (value: string) => void;
  expiryFilter: string;
  onExpiryFilter: (value: string) => void;
  batches: string[];
  statuses: Status[];
  products: string[];
  selectedCarton?: Carton;
  documents: DocumentRecord[];
  audit: AuditLog[];
  canReverse: boolean;
  onSelectCarton: (barcode: string) => void;
  onCloseDrawer: () => void;
  onScan: () => void;
  onCreateBatch: () => void;
  onPrintLabels: () => void;
  onExport: () => void;
  onReverse: (barcode: string, reason: string) => void;
}) {
  return (
    <section className="ops-page">
      <div className="ops-toolbar">
        <div>
          <h2>Inventory Control</h2>
          <p>Search by barcode, SKU, GTIN, product, or batch. Stock is calculated from actual carton records only.</p>
        </div>
        <div className="ops-toolbar__actions">
          <Button variant="secondary" onClick={onScan}><QrCode size={18} /> Scan Barcode</Button>
          <Button variant="secondary" onClick={onCreateBatch}><Boxes size={18} /> Create Batch</Button>
          <Button variant="secondary" onClick={onPrintLabels}><Printer size={18} /> Print Labels</Button>
          <Button variant="accent" onClick={onExport}><Download size={18} /> Export Inventory</Button>
        </div>
      </div>
      <div className="ops-kpi-row ops-kpi-row--six">
        <Stat label="Current cartons" value={cartons.filter((carton) => !lockedStatuses.includes(carton.status)).length} tone="accent" />
        <Stat label="Current units" value={metrics.units} tone="brand" />
        <Stat label="In transit" value={metrics.inTransit} tone="warning" />
        <Stat label="Pending receipts" value={pendingReceiptCartons} />
        <Stat label="Shortages" value={metrics.missing} tone="danger" />
        <Stat label="Near expiry" value={metrics.nearExpiry} tone="warning" />
      </div>
      <Card>
        <div className="ops-filter-grid">
          <label className="mm-field ops-search-field">
            <span className="mm-field__label">Global search</span>
            <input className="mm-input" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Barcode, SKU, GTIN, product, batch" />
          </label>
          <SelectField label="Warehouse" value={warehouseFilter} onChange={(event) => onWarehouseFilter(event.target.value)}>
            <option value="">All warehouses</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </SelectField>
          <SelectField label="Batch" value={batchFilter} onChange={(event) => onBatchFilter(event.target.value)}>
            <option value="">All batches</option>
            {batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}
          </SelectField>
          <SelectField label="Status" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </SelectField>
          <SelectField label="Product" value={productFilter} onChange={(event) => onProductFilter(event.target.value)}>
            <option value="">All SKUs</option>
            {products.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
          </SelectField>
          <SelectField label="Expiry" value={expiryFilter} onChange={(event) => onExpiryFilter(event.target.value)}>
            <option value="">All expiry</option>
            <option value="near">Near expiry</option>
            <option value="expired">Expired</option>
          </SelectField>
        </div>
      </Card>
      <Card title={<><Boxes size={18} /> Inventory by SKU, batch, location</>} action={<Tag mono>{filteredCartons.length} cartons</Tag>} pad={false}>
        <InventoryAggregateTable rows={rows} onSelectCarton={onSelectCarton} />
      </Card>
      <Card title="Damage / Write-off Queue">
        <div className="grid gap-2 md:grid-cols-2">
          {filteredCartons.filter((carton) => lockedStatuses.includes(carton.status)).slice(0, 12).map((carton) => (
            <CartonRow key={carton.id} carton={carton} warehouse={warehouseById[carton.warehouseId]} product={productById[carton.productId]} canReverse={canReverse} onReverse={onReverse} />
          ))}
          {!filteredCartons.some((carton) => lockedStatuses.includes(carton.status)) ? <EmptyState text="No damaged, lost, blocked, expired, or reversed cartons in this view." /> : null}
        </div>
      </Card>
      {selectedCarton ? (
        <CartonTimelineDrawer carton={selectedCarton} product={productById[selectedCarton.productId]} warehouse={warehouseById[selectedCarton.warehouseId]} documents={documents} audit={audit} onClose={onCloseDrawer} />
      ) : null}
    </section>
  );
}

function InventoryAggregateTable({ rows, onSelectCarton }: { rows: InventoryAggregateRow[]; onSelectCarton: (barcode: string) => void }) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table ops-inventory-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>GTIN</th>
            <th>Batch</th>
            <th>Warehouse</th>
            <th>Cartons</th>
            <th>Units/Carton</th>
            <th>Total Units</th>
            <th>Status</th>
            <th>Last Movement</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} onClick={() => onSelectCarton(row.sampleBarcode)} className="ops-click-row">
              <td className="text-[var(--text-strong)] font-bold">{row.product}</td>
              <td><Tag mono>{row.sku}</Tag></td>
              <td className="ds-mono">{row.gtin}</td>
              <td className="ds-mono">{row.batch}</td>
              <td>{row.warehouse}</td>
              <td className="ds-mono">{row.cartons}</td>
              <td className="ds-mono">{row.unitsPerCarton}</td>
              <td className="ds-mono">{row.totalUnits}</td>
              <td><StatusBadge status={row.status} /></td>
              <td className="ds-mono">{row.lastMovement}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <EmptyState text="No inventory matches the selected search and filters." /> : null}
    </div>
  );
}

function CartonTimelineDrawer({ carton, product, warehouse, documents, audit, onClose }: { carton: Carton; product?: Product; warehouse: string; documents: DocumentRecord[]; audit: AuditLog[]; onClose: () => void }) {
  const relatedDocs = documents.filter((doc) => doc.barcodes.includes(carton.barcode));
  const relatedAudit = audit.filter((item) => item.barcode === carton.barcode);
  const steps = [
    { label: "Created", active: true, detail: carton.mfd },
    { label: "Factory", active: ["IN_FACTORY", "IN_TRANSIT", "RECEIVED_AT_WAREHOUSE", "IN_TRANSIT_TRANSFER", "RECEIVED_AT_DESTINATION", "DISPATCHED_TO_CUSTOMER", "DELIVERED"].includes(carton.status), detail: product?.name ?? carton.flavour },
    { label: "Dispatch", active: relatedDocs.some((doc) => doc.type.includes("Dispatch")), detail: relatedDocs.find((doc) => doc.type.includes("Dispatch"))?.id },
    { label: "In Transit", active: carton.status.includes("IN_TRANSIT") || relatedDocs.some((doc) => doc.type.includes("Transfer")), detail: warehouse },
    { label: "Received", active: ["RECEIVED_AT_WAREHOUSE", "RECEIVED_AT_DESTINATION", "DELIVERED"].includes(carton.status), detail: warehouse },
    { label: "Customer / Exception", active: ["DISPATCHED_TO_CUSTOMER", "DELIVERED", "DAMAGED", "LOST", "BLOCKED", "EXPIRED"].includes(carton.status), detail: carton.customer ?? carton.status },
  ];
  return (
    <aside className="ops-drawer">
      <div className="ops-drawer__panel">
        <div className="ops-drawer__head">
          <div>
            <div className="ds-eyebrow">Carton Timeline</div>
            <h2>{carton.cartonNo}</h2>
            <p className="ds-mono">{carton.barcode}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="ops-carton-summary">
          <Tag mono>{carton.sku}</Tag>
          <StatusBadge status={carton.status} />
          <span>{warehouse}</span>
          <span>{carton.qty} {carton.qtyUnit}</span>
        </div>
        <div className="ops-timeline">
          {steps.map((step) => (
            <div className={`ops-timeline__item ${step.active ? "ops-timeline__item--active" : ""}`} key={step.label}>
              <span />
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail ?? "Pending"}</p>
              </div>
            </div>
          ))}
        </div>
        <Card title="Related documents">
          <div className="ops-mini-list">
            {relatedDocs.map((doc) => <div key={doc.id}><strong>{doc.id}</strong><span>{doc.type}</span></div>)}
            {!relatedDocs.length ? <EmptyState text="No documents attached yet." compact /> : null}
          </div>
        </Card>
        <Card title="Audit history">
          <div className="ops-mini-list">
            {relatedAudit.slice(0, 10).map((item) => <div key={item.id}><strong>{item.action}</strong><span>{new Date(item.time).toLocaleString()}</span></div>)}
            {!relatedAudit.length ? <EmptyState text="No carton audit events yet." compact /> : null}
          </div>
        </Card>
      </div>
    </aside>
  );
}

function OperationalScanWorkspace({
  session,
  scanInput,
  scanRef,
  scanMessage,
  cameraOn,
  fullscreen,
  canScan,
  cartons,
  products,
  warehouses,
  warehouseById,
  productById,
  sourceSessions,
  drafts,
  mismatches,
  onStart,
  onResume,
  onSessionChange,
  onSourceSessionChange,
  onScanInput,
  onScan,
  onUndo,
  onSaveDraft,
  onFinalize,
  onToggleCamera,
  onToggleFullscreen,
  onExportPacking,
}: {
  session: ScanSession | null;
  scanInput: string;
  scanRef: RefObject<HTMLInputElement | null>;
  scanMessage: { type: "ok" | "error"; text: string } | null;
  cameraOn: boolean;
  fullscreen: boolean;
  canScan: boolean;
  cartons: Carton[];
  products: Product[];
  warehouses: WarehouseRecord[];
  warehouseById: Record<string, string>;
  productById: Record<string, Product>;
  sourceSessions: { receiving: ScanSession[]; transferIn: ScanSession[] };
  drafts: ScanSession[];
  mismatches: MismatchCase[];
  onStart: (type: ScanSession["type"]) => void;
  onResume: (id: string) => void;
  onSessionChange: (session: ScanSession) => void;
  onSourceSessionChange: (id: string) => void;
  onScanInput: (value: string) => void;
  onScan: (barcode: string) => void;
  onUndo: () => void;
  onSaveDraft: () => void;
  onFinalize: () => void;
  onToggleCamera: () => void;
  onToggleFullscreen: () => void;
  onExportPacking: () => void;
}) {
  const expected = session?.expected ?? [];
  const scanned = session?.scanned ?? [];
  const missing = expected.filter((barcode) => !scanned.includes(barcode));
  const extra = expected.length ? scanned.filter((barcode) => !expected.includes(barcode)) : [];
  const duplicateCount = scanned.length - new Set(scanned).size;
  const errorCount = duplicateCount + extra.length + (scanMessage?.type === "error" ? 1 : 0);
  const remaining = expected.length ? missing.length : 0;
  const progress = expected.length ? Math.min(100, (scanned.length / expected.length) * 100) : scanned.length ? 100 : 0;
  const finalizeCheck = session ? validateFinalizeRule(session) : { ok: false, message: "Start a workflow first." };
  const shellClass = fullscreen ? "ops-scan-shell ops-scan-shell--fullscreen" : "ops-scan-shell";

  return (
    <section className={shellClass}>
      <aside className="ops-workflow-rail">
        <div className="ops-workflow-rail__title">Start workflow</div>
        <button className="ops-flow-button ops-flow-button--orange" onClick={() => onStart("Factory Dispatch")} disabled={!canScan}><Truck size={22} /> Factory Dispatch</button>
        <button className="ops-flow-button ops-flow-button--green" onClick={() => onStart("Warehouse Receive")} disabled={!canScan}><PackageCheck size={22} /> Warehouse Receive</button>
        <button className="ops-flow-button ops-flow-button--blue" onClick={() => onStart("Transfer Out")} disabled={!canScan}><ArrowRightLeft size={22} /> Transfer Out</button>
        <button className="ops-flow-button ops-flow-button--blue" onClick={() => onStart("Transfer In")} disabled={!canScan}><ArrowRightLeft size={22} /> Transfer In</button>
        <button className="ops-flow-button ops-flow-button--purple" onClick={() => onStart("Customer Dispatch")} disabled={!canScan}><Send size={22} /> Customer Dispatch</button>
        <div className="ops-drafts">
          <strong>Resume scan sessions</strong>
          {drafts.length ? drafts.slice(0, 8).map((draft) => (
            <button key={draft.id} onClick={() => onResume(draft.id)}>
              <span>{draft.type}</span>
              <small>{draft.scanned.length} scanned / {new Date(draft.updatedAt).toLocaleString()}</small>
            </button>
          )) : <EmptyState text="No saved scan drafts." compact />}
        </div>
      </aside>
      <div className="ops-scan-main">
        {session ? (
          <>
            <ScanRouteHeader session={session} warehouseById={warehouseById} onExportPacking={onExportPacking} onFinalize={onFinalize} onToggleFullscreen={onToggleFullscreen} canFinalize={finalizeCheck.ok && scanned.length > 0} fullscreen={fullscreen} />
            <ScanWizardSteps session={session} />
            <div className="ops-count-grid">
              <CounterCard label="Expected" value={expected.length ? expected.length : "Open"} />
              <CounterCard label="Scanned" value={scanned.length} tone="blue" />
              <CounterCard label="Remaining" value={remaining} tone={remaining ? "orange" : "green"} />
              <CounterCard label="Errors" value={errorCount} tone={errorCount ? "red" : "green"} />
            </div>
            <div className="ops-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="ops-scan-layout">
              <ScanEnginePanel
                session={session}
                scanInput={scanInput}
                scanRef={scanRef}
                scanMessage={scanMessage}
                cameraOn={cameraOn}
                sourceSessions={sourceSessions}
                warehouses={warehouses}
                onSessionChange={onSessionChange}
                onSourceSessionChange={onSourceSessionChange}
                onScanInput={onScanInput}
                onScan={onScan}
                onUndo={onUndo}
                onSaveDraft={onSaveDraft}
                onFinalize={onFinalize}
                onToggleCamera={onToggleCamera}
                canFinalize={finalizeCheck.ok && scanned.length > 0}
                finalizeMessage={finalizeCheck.message}
              />
              <ScanReviewPanel session={session} cartons={cartons} products={products} productById={productById} warehouseById={warehouseById} missing={missing} extra={extra} mismatches={mismatches} />
            </div>
          </>
        ) : (
          <div className="ops-empty-scan">
            <QrCode size={42} />
            <h2>Select a workflow to begin scanning</h2>
            <p>Every movement remains a draft until finalized. Page refreshes keep finalized operational data in Supabase.</p>
            <div className="ops-mobile-start">
              <button className="ops-flow-button ops-flow-button--orange" onClick={() => onStart("Factory Dispatch")} disabled={!canScan}><Truck size={22} /> Factory Dispatch</button>
              <button className="ops-flow-button ops-flow-button--green" onClick={() => onStart("Warehouse Receive")} disabled={!canScan}><PackageCheck size={22} /> Warehouse Receive</button>
              <button className="ops-flow-button ops-flow-button--blue" onClick={() => onStart("Transfer Out")} disabled={!canScan}><ArrowRightLeft size={22} /> Transfer Out</button>
              <button className="ops-flow-button ops-flow-button--purple" onClick={() => onStart("Customer Dispatch")} disabled={!canScan}><Send size={22} /> Customer Dispatch</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ScanRouteHeader({ session, warehouseById, onExportPacking, onFinalize, onToggleFullscreen, canFinalize, fullscreen }: { session: ScanSession; warehouseById: Record<string, string>; onExportPacking: () => void; onFinalize: () => void; onToggleFullscreen: () => void; canFinalize: boolean; fullscreen: boolean }) {
  const source = warehouseById[session.sourceWarehouseId] ?? session.sourceWarehouseId;
  const destination = session.destinationWarehouseId ? warehouseById[session.destinationWarehouseId] : session.customer ?? "Customer";
  return (
    <div className="ops-route-card">
      <div className="ops-route-card__icon"><Truck size={26} /></div>
      <div>
        <h2>{session.id}</h2>
        <div className="ops-route-meta">
          <Tag mono>{session.type}</Tag>
          <span>{source}</span>
          <span>to</span>
          <span>{destination}</span>
          <StatusBadge tone={session.finalized ? "teal" : "blue"}>{session.finalized ? "Finalized" : "Active"}</StatusBadge>
        </div>
      </div>
      <div className="ops-route-card__actions">
        <Button variant="secondary" onClick={onExportPacking}><Download size={16} /> Excel</Button>
        <Button variant="secondary" onClick={onToggleFullscreen}>{fullscreen ? "Exit Fullscreen" : "Fullscreen"}</Button>
        <Button variant="accent" disabled={!canFinalize} onClick={onFinalize}><CheckCircle2 size={18} /> Finalize</Button>
      </div>
    </div>
  );
}

function ScanWizardSteps({ session }: { session: ScanSession }) {
  const steps = session.type === "Warehouse Receive"
    ? ["Select incoming dispatch", "Show expected cartons", "Scan received cartons", "Compare", "Finalize or investigate"]
    : session.type === "Transfer In"
      ? ["Select transfer-out", "Show expected", "Scan transfer-in", "Match", "Finalize or investigate"]
      : session.type === "Transfer Out"
        ? ["Source warehouse", "Destination warehouse", "Batch/SKU", "Scan transfer-out", "Finalize slip"]
        : session.type === "Customer Dispatch"
          ? ["Customer", "Source warehouse", "Batch/SKU", "Scan cartons", "Challan and slip"]
          : ["Source", "Destination", "Batch/SKU", "Scan cartons", "Packing list", "Dispatch slip"];
  return (
    <div className="ops-wizard">
      {steps.map((step, index) => <div key={step} className={index <= 3 ? "ops-wizard__step ops-wizard__step--active" : "ops-wizard__step"}><span>{index + 1}</span>{step}</div>)}
    </div>
  );
}

function CounterCard({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "blue" | "green" | "orange" | "red" }) {
  return (
    <div className={`ops-counter ops-counter--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScanEnginePanel({
  session,
  scanInput,
  scanRef,
  scanMessage,
  cameraOn,
  sourceSessions,
  warehouses,
  onSessionChange,
  onSourceSessionChange,
  onScanInput,
  onScan,
  onUndo,
  onSaveDraft,
  onFinalize,
  onToggleCamera,
  canFinalize,
  finalizeMessage,
}: {
  session: ScanSession;
  scanInput: string;
  scanRef: RefObject<HTMLInputElement | null>;
  scanMessage: { type: "ok" | "error"; text: string } | null;
  cameraOn: boolean;
  sourceSessions: { receiving: ScanSession[]; transferIn: ScanSession[] };
  warehouses: WarehouseRecord[];
  onSessionChange: (session: ScanSession) => void;
  onSourceSessionChange: (id: string) => void;
  onScanInput: (value: string) => void;
  onScan: (barcode: string) => void;
  onUndo: () => void;
  onSaveDraft: () => void;
  onFinalize: () => void;
  onToggleCamera: () => void;
  canFinalize: boolean;
  finalizeMessage: string;
}) {
  const sourceOptions = session.type === "Warehouse Receive" ? sourceSessions.receiving : sourceSessions.transferIn;
  return (
    <Card className="ops-scan-card">
      <div className="ops-card-title"><QrCode size={18} /> What am I scanning?</div>
      <p className="ops-muted">{session.type.includes("Receive") || session.type === "Transfer In" ? "Scan received cartons from the selected incoming movement." : "Scan carton labels for this outbound movement. USB and Bluetooth scanners work as keyboard input."}</p>
      {session.type === "Warehouse Receive" || session.type === "Transfer In" ? (
        <SelectField label="Incoming dispatch / transfer" value={session.sourceSessionId ?? ""} onChange={(event) => onSourceSessionChange(event.target.value)}>
          <option value="">Select incoming movement</option>
          {sourceOptions.map((item) => <option key={item.id} value={item.id}>{item.id} / {item.scanned.length} cartons</option>)}
        </SelectField>
      ) : null}
      <div className="ops-form-grid">
        <SelectField label="Destination / Warehouse" value={session.destinationWarehouseId ?? ""} onChange={(event) => onSessionChange({ ...session, destinationWarehouseId: event.target.value, updatedAt: now() })}>
          <option value="">Customer / not applicable</option>
          {warehouses.filter((item) => item.type === "warehouse").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </SelectField>
        <TextField label="Customer" value={session.customer ?? ""} onChange={(event) => onSessionChange({ ...session, customer: event.target.value, updatedAt: now() })} />
        <TextField label="Vehicle number" value={session.vehicle ?? ""} onChange={(event) => onSessionChange({ ...session, vehicle: event.target.value, updatedAt: now() })} />
        <TextField label="Driver name" value={session.driver ?? ""} onChange={(event) => onSessionChange({ ...session, driver: event.target.value, updatedAt: now() })} />
        <TextField label="LR / docket" value={session.lr ?? ""} onChange={(event) => onSessionChange({ ...session, lr: event.target.value, updatedAt: now() })} />
        <TextField label="Transporter" value={session.transporter ?? ""} onChange={(event) => onSessionChange({ ...session, transporter: event.target.value, updatedAt: now() })} />
      </div>
      <form
        className="ops-scan-form"
        onSubmit={(event) => {
          event.preventDefault();
          onScan(scanInput);
        }}
      >
        <label className="mm-field">
          <span className="mm-field__label">Large scanner input</span>
          <input ref={scanRef} value={scanInput} onChange={(event) => onScanInput(event.target.value)} className="mm-input mm-input--mono ops-scan-input" placeholder="Scan barcode - press Enter" autoComplete="off" />
        </label>
        <Button variant="accent" size="lg" onClick={() => onScan(scanInput)}><QrCode size={20} /> Scan</Button>
      </form>
      {scanMessage ? <div className={`ops-scan-feedback ops-scan-feedback--${scanMessage.type}`}>{scanMessage.type === "ok" ? "Accepted" : "Review"}: {scanMessage.text}</div> : null}
      {cameraOn ? <CameraScanner onScan={onScan} /> : null}
      <div className="ops-scan-actions">
        <Button variant="secondary" onClick={onToggleCamera}><Camera size={18} /> Camera</Button>
        <Button variant="secondary" onClick={onUndo}>Undo last scan</Button>
        <Button variant="secondary" onClick={onSaveDraft}>Save draft</Button>
      </div>
      <div className="ops-finalize-note">{canFinalize ? "Ready to finalize." : finalizeMessage}</div>
      <div className="ops-sticky-finalize">
        <Button block variant="accent" disabled={!canFinalize} onClick={onFinalize}><CheckCircle2 size={18} /> Finalize movement</Button>
      </div>
    </Card>
  );
}

function ScanReviewPanel({ session, cartons, productById, warehouseById, missing, extra, mismatches }: { session: ScanSession; cartons: Carton[]; products: Product[]; productById: Record<string, Product>; warehouseById: Record<string, string>; missing: string[]; extra: string[]; mismatches: MismatchCase[] }) {
  const duplicateCount = session.scanned.length - new Set(session.scanned).size;
  return (
    <div className="ops-review-stack">
      <Card title={<><History size={18} /> Recent scans</>} action={<Tag mono>{session.scanned.length}</Tag>}>
        <div className="ops-recent-scans">
          {session.scanned.slice(0, 8).map((barcode) => {
            const carton = cartons.find((item) => item.barcode === barcode);
            return (
              <div key={barcode}>
                <strong>{carton?.sku ?? "Unknown barcode"}</strong>
                <span className="ds-mono">{barcode}</span>
                <StatusBadge status={carton?.status} tone={carton ? undefined : "red"}>{carton?.status ?? "UNKNOWN"}</StatusBadge>
              </div>
            );
          })}
          {!session.scanned.length ? <EmptyState text="No scans yet." compact /> : null}
        </div>
      </Card>
      <Card title={<><Boxes size={18} /> Packing list</>}>
        <div className="ops-packing-list">
          {session.scanned.map((barcode) => {
            const carton = cartons.find((item) => item.barcode === barcode);
            return carton ? <CartonRow key={barcode} carton={carton} warehouse={warehouseById[carton.warehouseId]} product={productById[carton.productId]} /> : <div key={barcode} className="ops-unknown-row">{barcode}<StatusBadge tone="red">Unknown barcode</StatusBadge></div>;
          })}
          {!session.scanned.length ? <EmptyState text="No cartons scanned yet." compact /> : null}
        </div>
      </Card>
      <Card title="Receiving comparison">
        <div className="ops-compare-grid">
          <CounterCard label="Missing" value={missing.length} tone={missing.length ? "red" : "green"} />
          <CounterCard label="Extra" value={extra.length} tone={extra.length ? "red" : "green"} />
          <CounterCard label="Duplicate" value={duplicateCount} tone={duplicateCount ? "red" : "green"} />
          <CounterCard label="Open cases" value={mismatches.filter((item) => item.status !== "Closed").length} tone="orange" />
        </div>
        <div className="ops-missing-list">
          {missing.slice(0, 12).map((barcode) => <div key={barcode} className="ds-mono">{barcode}</div>)}
          {!missing.length ? <EmptyState text="No missing cartons for the selected movement." compact /> : null}
        </div>
      </Card>
    </div>
  );
}

function InventoryTable({ rows, warehouseById }: { rows: Carton[]; warehouseById: Record<string, string> }) {
  return (
    <div className="ds-table-wrap">
      <table className="ds-table">
        <thead>
          <tr>
            <th>Barcode</th>
            <th>SKU</th>
            <th>Batch</th>
            <th>Warehouse</th>
            <th>Expiry</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((carton) => (
            <tr key={carton.id}>
              <td className="ds-mono text-[var(--text-strong)]">...{carton.barcode.slice(-12)}</td>
              <td><Tag mono>{carton.sku}</Tag></td>
              <td className="ds-mono">{carton.batch}</td>
              <td>{warehouseById[carton.warehouseId]}</td>
              <td className="ds-mono">{carton.expiry}</td>
              <td><StatusBadge status={carton.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <EmptyState text="No cartons match the current role and mode." /> : null}
    </div>
  );
}

function ChartBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: "teal" | "blue" | "slate" | "red" }) {
  return (
    <div className="chart-bar">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-[var(--text-strong)]">{label}</span>
        <span className="font-mono text-sm font-bold text-[var(--text-muted)]">{value}</span>
      </div>
      <div className="chart-bar-track">
        <span className={`chart-bar-fill chart-bar-fill--${tone}`} style={{ width: `${Math.max(4, (value / total) * 100)}%` }} />
      </div>
    </div>
  );
}

function AlertPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="ds-alert-panel">
      <div className="ds-alert-panel__title"><AlertTriangle size={16} className="text-[var(--warning-500)]" /> {title}</div>
      <div className="ds-alert-panel__items">
        {items.length ? items.map((item) => <div key={item} className="ds-alert-panel__item">{item}</div>) : <EmptyState text="Nothing pending." compact />}
      </div>
    </div>
  );
}

function DemoDataManager({
  mode,
  goLiveAt,
  demoCounts,
  demoProducts,
  demoCartons,
  demoDocuments,
  onSetMode,
  onArchive,
  onRestore,
  onDelete,
  onGoLive,
}: {
  mode: AppMode;
  goLiveAt?: string;
  demoCounts: { products: number; cartons: number; sessions: number; documents: number; mismatches: number; archived: number };
  demoProducts: Product[];
  demoCartons: Carton[];
  demoDocuments: DocumentRecord[];
  onSetMode: (mode: AppMode) => void;
  onArchive: (reason: string) => void;
  onRestore: (reason: string) => void;
  onDelete: (reason: string) => void;
  onGoLive: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const demoTotal = demoCounts.products + demoCounts.cartons + demoCounts.sessions + demoCounts.documents + demoCounts.mismatches;
  return (
    <section className="grid gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mm-card__title">System Mode</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Development Mode keeps UAT demo workflows visible. Production Mode hides demo operational records and shows only real business data.</p>
          </div>
          <StatusBadge tone={mode === "development" ? "amber" : "teal"}>{mode === "development" ? "Development Mode" : "Production Mode"}</StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={mode === "development" ? "primary" : "secondary"} onClick={() => onSetMode("development")}>Development Mode</Button>
          <Button variant={mode === "production" ? "primary" : "secondary"} onClick={() => onSetMode("production")}>Production Mode</Button>
        </div>
        {goLiveAt ? <div className="mt-3 rounded-xl bg-[var(--teal-50)] p-3 text-sm font-semibold text-[var(--teal-700)]">Go Live completed at {new Date(goLiveAt).toLocaleString()}</div> : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Demo products" value={demoCounts.products} />
        <Stat label="Demo cartons" value={demoCounts.cartons} />
        <Stat label="Demo sessions" value={demoCounts.sessions} />
        <Stat label="Demo documents" value={demoCounts.documents} />
        <Stat label="Demo cases" value={demoCounts.mismatches} />
        <Stat label="Archived demo" value={demoCounts.archived} tone={demoCounts.archived ? "amber" : "slate"} />
      </div>

      <Card>
        <h2 className="mm-card__title">Production Cutover Tool</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Go Live archives demo inventory, products, dispatches, reports, and mismatch cases, then switches to Production Mode. Users, warehouses, barcode templates, audit logs, and configuration are preserved.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto_auto]">
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reason for demo data action" className="mm-input text-sm" />
          <Button variant="secondary" disabled={!reason.trim() || demoTotal === 0} onClick={() => onArchive(reason)}>Archive Demo Data</Button>
          <Button variant="secondary" disabled={!reason.trim() || demoTotal === 0} onClick={() => onRestore(reason)}>Restore Demo Data</Button>
          <Button disabled={!reason.trim()} onClick={() => onGoLive(reason)}><CheckCircle2 size={18} /> Go Live</Button>
          <Button variant="danger" disabled={!reason.trim() || demoTotal === 0} onClick={() => onDelete(reason)}>Delete Permanently</Button>
        </div>
      </Card>

      <section className="grid gap-5 xl:grid-cols-3">
        <DemoList title="Demo Products" rows={demoProducts.map((item) => `${item.archived ? "[Archived] " : ""}${item.sku} / ${item.flavour} / ${item.caseQty}${item.qtyUnit}`)} />
        <DemoList title="Demo Inventory" rows={demoCartons.slice(0, 40).map((item) => `${item.archived ? "[Archived] " : ""}${item.barcode} / ${item.status}`)} />
        <DemoList title="Demo Documents" rows={demoDocuments.map((item) => `${item.archived ? "[Archived] " : ""}${item.id} / ${item.type} / ${item.barcodes.length} cartons`)} />
      </section>
    </section>
  );
}

function DemoList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <Card>
      <h3 className="font-bold text-[var(--text-strong)]">{title}</h3>
      <div className="mt-3 max-h-[420px] space-y-2 overflow-auto">
        {rows.length ? rows.map((row) => <div key={row} className="rounded-xl bg-[var(--slate-50)] p-2 font-mono text-xs text-[var(--text-body)]">{row}</div>) : <EmptyState text="No demo records." compact />}
      </div>
    </Card>
  );
}

function PreLaunchChecklist({
  supabaseStatus,
  mode,
  hasRealProducts,
  hasRealCartons,
  hasDispatch,
  hasReceiving,
  hasTransfer,
  hasReports,
  hasPdfDocuments,
  hasBarcodeData,
  hasAuditLogs,
}: {
  supabaseStatus: "checking" | "connected" | "missing" | "error";
  mode: AppMode;
  hasRealProducts: boolean;
  hasRealCartons: boolean;
  hasDispatch: boolean;
  hasReceiving: boolean;
  hasTransfer: boolean;
  hasReports: boolean;
  hasPdfDocuments: boolean;
  hasBarcodeData: boolean;
  hasAuditLogs: boolean;
}) {
  const checks = [
    { label: "Supabase connected", ok: supabaseStatus === "connected", detail: supabaseStatus },
    { label: "Products persisted in Supabase", ok: hasRealProducts, detail: hasRealProducts ? "Real products saved" : "Create a real product" },
    { label: "Inventory persisted in Supabase", ok: hasRealCartons || hasBarcodeData, detail: hasRealCartons ? "Real cartons saved" : "Demo/UAT cartons loaded from Supabase" },
    { label: "Dispatches persisted in Supabase", ok: hasDispatch, detail: "Dispatch session and slip loaded from Supabase" },
    { label: "Receiving persisted in Supabase", ok: hasReceiving, detail: hasReceiving ? "Receiving document loaded from Supabase" : "Run a receiving UAT flow" },
    { label: "Transfers persisted in Supabase", ok: hasTransfer, detail: hasTransfer ? "Transfer document loaded from Supabase" : "Run a transfer UAT flow" },
    { label: "Reports generated from Supabase", ok: hasReports, detail: "Report documents loaded from Supabase" },
    { label: "Audit logs generated from Supabase", ok: hasAuditLogs, detail: hasAuditLogs ? "Audit logs loaded from Supabase" : "Create an audited action" },
    { label: "PDF generation working", ok: hasPdfDocuments, detail: "Document records can generate PDFs" },
    { label: "Barcode scanning working", ok: hasBarcodeData, detail: "Barcode registry/cartons available" },
    { label: "Production mode ready", ok: mode === "production" && hasRealProducts, detail: mode === "production" ? "Production Mode active" : "Still in Development Mode" },
  ];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="mm-card__title">Pre-launch Checklist</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Use this during UAT. A red item means the workflow still needs real-data testing before cutover.</p>
        </div>
        <Tag tone="brand">{checks.filter((item) => item.ok).length}/{checks.length} ready</Tag>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {checks.map((item) => (
          <div key={item.label} className={`rounded-xl border p-3 ${item.ok ? "border-[var(--teal-100)] bg-[var(--teal-50)]" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-2 font-bold">
              {item.ok ? <CheckCircle2 size={18} className="text-[var(--teal-700)]" /> : <AlertTriangle size={18} className="text-amber-700" />}
              {item.label}
            </div>
            <div className="mt-1 text-sm text-[var(--text-muted)]">{item.detail}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function readImportRows(file: File): Promise<Record<string, string | number>[]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  const rows = await readSheet(file);
  if (!rows.length) return [];
  const headers = rows[0].map((cell) => String(cell ?? "").trim());
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] instanceof Date ? (row[index] as Date).toISOString().slice(0, 10) : String(row[index] ?? "")])),
  );
}

function parseCsv(text: string) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine).map((item) => item.trim());
  return lines.filter(Boolean).map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [headers[index], value.trim()])));
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function CartonRow({ carton, warehouse, product, canReverse = false, onReverse }: { carton: Carton; warehouse: string; product?: Product; canReverse?: boolean; onReverse?: (barcode: string, reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="ds-row-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-bold text-[var(--text-strong)]">...{carton.barcode.slice(-14)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-bold">
            <Tag mono>{carton.sku}</Tag>
            <span>{product?.flavour ?? carton.flavour}</span>
            <Tag mono>{carton.cartonNo}</Tag>
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">{warehouse} / Batch {carton.batch} / Exp {carton.expiry}</div>
        </div>
        <StatusBadge status={carton.status} />
      </div>
      {canReverse && onReverse ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reversal reason" className="mm-input min-h-10 text-sm" />
          <Button variant="danger" disabled={!reason.trim()} onClick={() => onReverse(carton.barcode, reason)}>
            <XCircle size={18} /> Reverse
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DocumentCard({ doc, onReprint }: { doc: DocumentRecord; onReprint: (doc: DocumentRecord, reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-[var(--text-strong)]">{doc.type}</div>
          <div className="font-mono text-xs text-[var(--text-muted)]">{doc.id}</div>
        </div>
        <FileText className="text-[var(--blue-600)]" />
      </div>
      <div className="mt-3 text-sm text-[var(--text-muted)]">{doc.source ?? "-"} -&gt; {doc.destination ?? "-"}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Tag tone="accent">{doc.barcodes.length} cartons</Tag>
        {doc.vehicle ? <Tag mono>{doc.vehicle}</Tag> : null}
        {doc.driver ? <Tag>{doc.driver}</Tag> : null}
      </div>
      {doc.discrepancy ? <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800">{doc.discrepancy}</div> : null}
      <div className="mt-3 grid gap-2">
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reprint reason" className="mm-input min-h-10 text-sm" />
        <Button variant="secondary" disabled={!reason.trim()} onClick={() => onReprint(doc, reason)}><Printer size={18} /> PDF / reprint</Button>
      </div>
    </Card>
  );
}

function ProductsPanel({
  products,
  cartons,
  patterns,
  onAddProduct,
  onGenerateBatch,
}: {
  products: Product[];
  cartons: Carton[];
  patterns: BarcodePattern[];
  onAddProduct: (form: FormData) => void;
  onGenerateBatch: (productId: string, batch: string, startNo: number, endNo: number) => void;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [batch, setBatch] = useState("B2607A");
  const [startNo, setStartNo] = useState(1);
  const [endNo, setEndNo] = useState(12);
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <form
        className="mm-card mm-card--pad"
        onSubmit={(event) => {
          event.preventDefault();
          onAddProduct(new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}
      >
        <h2 className="mm-card__title">Product creation wizard</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextField name="name" label="Product name" required defaultValue="Mr Makhana Roasted Makhana" />
          <TextField name="flavour" label="Flavour" required />
          <TextField name="category" label="Category" required defaultValue="Fox Nuts" />
          <TextField name="sku" label="SKU" required />
          <TextField name="gtin" label="GTIN" required />
          <TextField name="prefix" label="Prefix" required defaultValue="MM" />
          <TextField name="weight" label="Weight" required placeholder="70G" />
          <TextField name="mrp" label="MRP" type="number" required />
          <TextField name="caseQty" label="Case quantity" type="number" required />
          <SelectField name="qtyUnit" label="Quantity unit"><option value="pcs">pcs</option><option value="pc">pc</option><option value="p">p</option></SelectField>
          <TextField name="variantCode" label="Variant code" required />
          <TextField name="shelfLifeDays" label="Shelf life days" type="number" required defaultValue={180} />
          <TextField name="hsn" label="HSN optional" />
          <SelectField name="status" label="Status"><option value="Active">Active</option><option value="Blocked">Blocked</option></SelectField>
        </div>
        <TextField name="template" label="Barcode template" required defaultValue={barcodeTemplate} className="mt-4" mono />
        <Button type="submit" className="mt-4"><Archive size={18} /> Create product</Button>
      </form>
      <Card title="Batch / carton generation">
        <div className="mt-4 grid gap-3">
          <SelectField label="Product" value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} / {item.flavour}</option>)}</SelectField>
          <TextField label="Batch" value={batch} onChange={(event) => setBatch(event.target.value)} />
          <TextField label="Start carton no" type="number" min={minCartonNo} max={maxCartonNo} value={startNo} onChange={(event) => setStartNo(Number(event.target.value))} />
          <TextField label="End carton no" type="number" min={minCartonNo} max={maxCartonNo} value={endNo} onChange={(event) => setEndNo(Number(event.target.value))} />
          <Button onClick={() => onGenerateBatch(productId, batch, startNo, endNo)}><Printer size={18} /> Generate carton range and labels</Button>
        </div>
        <div className="mt-5 space-y-2">
          {products.map((product) => {
            const productCartons = cartons.filter((carton) => carton.productId === product.id);
            const currentInventory = productCartons.filter((carton) => ["IN_FACTORY", "RECEIVED_AT_WAREHOUSE", "RECEIVED_AT_DESTINATION"].includes(carton.status)).length;
            const inTransit = productCartons.filter((carton) => carton.status.includes("IN_TRANSIT")).length;
            const dispatched = productCartons.filter((carton) => ["DISPATCHED_TO_CUSTOMER", "DELIVERED"].includes(carton.status)).length;
            const damagedLost = productCartons.filter((carton) => ["DAMAGED", "LOST"].includes(carton.status)).length;
            const pattern = patterns.find((item) => item.sku === product.sku);
            return (
            <div key={product.id} className="rounded-xl border border-[var(--border-subtle)] bg-white p-3 shadow-[var(--shadow-xs)]">
                <div className="flex flex-wrap items-center gap-2 font-bold text-[var(--text-strong)]"><Tag mono>{product.sku}</Tag><span>{product.flavour}</span></div>
                <div className="mt-2 text-sm text-[var(--text-muted)]">{product.caseQty}{product.qtyUnit} / MRP {product.mrp}</div>
                <div className="mt-2 font-mono text-xs text-[var(--text-muted)]">{pattern?.exampleBarcode ?? generateBarcode(product, "BATCH1", "00001")}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Stat label="Valid range" value="00001-99999" />
                  <Stat label="Actual cartons" value={productCartons.length} tone="emerald" />
                  <Stat label="Current inventory" value={currentInventory} />
                  <Stat label="In transit" value={inTransit} tone="amber" />
                  <Stat label="Dispatched" value={dispatched} />
                  <Stat label="Damaged/Lost" value={damagedLost} tone={damagedLost ? "rose" : "slate"} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function ReportTable({ title, rows }: { title: string; rows: Record<string, string | number | undefined>[] }) {
  const headers = Object.keys(rows[0] ?? { empty: "" });
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="mm-card__title p-5 pb-0">{title}</h2>
        <Button
          className="mr-5 mt-5"
          variant="secondary"
          onClick={() => {
            const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${title.toLowerCase().replaceAll(" ", "-")}.csv`;
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download size={18} /> CSV
        </Button>
      </div>
      <div className="ds-table-wrap mt-4">
        <table className="ds-table min-w-[720px]">
          <thead>
            <tr>
              {headers.map((header) => <th key={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((row, index) => (
              <tr key={index}>
                {headers.map((header) => <td key={header} className="max-w-[260px] truncate">{row[header]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <EmptyState text="No rows to report yet." /> : null}
      </div>
    </Card>
  );
}

function MismatchApproval({ onApprove }: { onApprove: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
      <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory approval/write-off reason" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
      <Button disabled={!reason.trim()} onClick={() => onApprove(reason)}><CheckCircle2 size={18} /> Approve</Button>
    </div>
  );
}

function findDuplicates(items: string[]) {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  items.forEach((item) => {
    if (seen.has(item)) dupes.add(item);
    seen.add(item);
  });
  return [...dupes];
}

function CameraScanner({ onScan }: { onScan: (barcode: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function start() {
      try {
        const qrModule = await import("html5-qrcode");
        if (!mounted || !hostRef.current) return;
        const scanner = new qrModule.Html5Qrcode("camera-reader");
        scannerRef.current = scanner;
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 160 } }, (decodedText) => onScan(decodedText), undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera scanner could not start.");
      }
    }
    start();
    return () => {
      mounted = false;
      scannerRef.current?.stop().then(() => scannerRef.current?.clear()).catch(() => undefined);
    };
  }, [onScan]);

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3">
      <div ref={hostRef} id="camera-reader" className="min-h-[220px] overflow-hidden rounded-lg bg-slate-950" />
      {error ? <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm font-semibold text-amber-800">{error}</div> : null}
    </div>
  );
}
