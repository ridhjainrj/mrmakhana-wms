"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  BarChart3,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  History,
  Lock,
  LogOut,
  PackageCheck,
  Printer,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Truck,
  Upload,
  Warehouse,
  XCircle,
} from "lucide-react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { readSheet } from "read-excel-file/browser";
import {
  barcodeTemplate,
  buildBarcodeFromTemplate,
  canRole,
  daysFrom,
  lockedStatuses,
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

type WarehouseRecord = {
  id: string;
  dbId?: string;
  name: string;
  type: "factory" | "warehouse" | "transit";
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
  };
}
function can(user: User, action: "manage" | "sensitive" | "scan" | "view") {
  return canRole(user.role, action);
}

function isOperationalRecord(record: { dataOrigin?: DataOrigin; archived?: boolean }, mode: AppMode) {
  if (record.archived) return false;
  if (mode === "production" && record.dataOrigin === "demo") return false;
  return true;
}

function isDemoRecord(record: { dataOrigin?: DataOrigin }) {
  return record.dataOrigin === "demo";
}

function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    secondary: "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
    danger: "bg-rose-700 text-white hover:bg-rose-800",
    ghost: "text-slate-700 hover:bg-slate-100",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const toneMap = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  };
  return (
    <div className={`rounded-lg border p-4 ${toneMap[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
    </div>
  );
}

function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className, ...rest } = props;
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {label}
      <input
        {...rest}
        className={`min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 ${className ?? ""}`}
      />
    </label>
  );
}

function SelectField(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) {
  const { label, children, className, ...rest } = props;
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {label}
      <select
        {...rest}
        className={`min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 ${className ?? ""}`}
      >
        {children}
      </select>
    </label>
  );
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
  const [importErrors, setImportErrors] = useState<string[]>([]);
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
        const next = { ...data, registry: data.cartons };
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
  const resolveWarehouseId = useCallback(
    (value: string) => {
      const normalized = value.trim().toLowerCase();
      return state.warehouses.find((item) => item.id.toLowerCase() === normalized || item.name.toLowerCase() === normalized)?.id ?? factoryWarehouseId;
    },
    [factoryWarehouseId, state.warehouses],
  );
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...next, registry: next.cartons }),
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
  }, []);

  function mutate(updater: (draft: AppState) => void) {
    setState((current) => {
      const draft: AppState = JSON.parse(JSON.stringify(current));
      updater(draft);
      draft.registry = draft.cartons;
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
    setView("Scanning");
  }

  function validateScan(barcode: string, activeSession: ScanSession) {
    const duplicateDraft = operationalSessions.find((item) => !item.finalized && item.id !== activeSession.id && item.scanned.includes(barcode));
    if (duplicateDraft) return { ok: false, message: `Duplicate scan blocked: carton is already in draft ${duplicateDraft.type}.` };
    return validateScanRule(barcode, activeSession, operationalCartons, operationalProducts);
  }

  function handleScan(raw: string) {
    if (!session || !user) return;
    const barcode = raw.trim();
    if (!barcode) return;
    const result = validateScan(barcode, session);
    setScanMessage({ type: result.ok ? "ok" : "error", text: result.message });
    if (!result.ok) {
      setScanInput("");
      return;
    }
    setSession({ ...session, scanned: [barcode, ...session.scanned], updatedAt: now() });
    setScanInput("");
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
      setView("Scanning");
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
    await downloadDocument(doc);
    audit("Document reprinted", { documentRef: doc.id, reason });
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

  async function importExcel(file: File) {
    if (!user || !can(user, "sensitive")) return;
    const rows = await readImportRows(file);
    const errors: string[] = [];
    const existing = new Set(state.cartons.map((carton) => carton.barcode));
    const imported: Carton[] = [];
    rows.forEach((row, index) => {
      const barcode = String(row.barcode_value ?? row.barcode ?? "").trim();
      const parsed = parseTemplateBarcode(barcode, state.products);
      if (!barcode) errors.push(`Row ${index + 2}: missing barcode_value`);
      else if (existing.has(barcode) || imported.some((carton) => carton.barcode === barcode)) errors.push(`Row ${index + 2}: duplicate barcode ${barcode}`);
      else if (!parsed?.sku || !parsed.qty) errors.push(`Row ${index + 2}: invalid barcode/template`);
      else {
        imported.push({
          id: uid("carton"),
          barcode,
          productId: parsed.productId!,
          sku: String(row.sku ?? parsed.sku),
          gtin: parsed.gtin!,
          flavour: parsed.flavour!,
          weight: parsed.weight!,
          mrp: Number(row.mrp ?? parsed.mrp),
          qty: Number(row.carton_quantity ?? parsed.qty),
          qtyUnit: parsed.qtyUnit!,
          batch: String(row.batch ?? parsed.batch),
          mfd: String(row.mfd ?? new Date().toISOString().slice(0, 10)),
          expiry: String(row.expiry ?? new Date(new Date().setDate(new Date().getDate() + 180)).toISOString().slice(0, 10)),
          cartonNo: String(row.carton_number ?? parsed.cartonNo),
          warehouseId: resolveWarehouseId(String(row.current_warehouse ?? factoryWarehouseId)),
          status: "IN_FACTORY",
          dataOrigin: "real",
        });
      }
    });
    setImportErrors(errors);
    if (imported.length) {
      mutate((draft) => {
        draft.cartons.push(...imported);
        draft.registry.push(...imported);
      });
      audit("Excel barcode registry import", { reason: `${imported.length} cartons imported, ${errors.length} rejected.` });
    }
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
    mutate((draft) => draft.products.unshift(product));
    audit("Product created", { newValue: product.sku });
  }

  function generateBatch(productId: string, batch: string, count: number) {
    if (!user || !can(user, "sensitive")) return;
    const product = state.products.find((item) => item.id === productId);
    if (!product) return;
    const start = state.cartons.filter((carton) => carton.productId === productId && carton.batch === batch).length + 1;
    const generatedAt = new Date();
    const mfd = generatedAt.toISOString().slice(0, 10);
    const expiryDate = new Date(generatedAt);
    expiryDate.setDate(expiryDate.getDate() + product.shelfLifeDays);
    const expiry = expiryDate.toISOString().slice(0, 10);
    const created = Array.from({ length: count }, (_, index) => {
      const cartonNo = String(start + index).padStart(5, "0");
      return {
        id: uid("carton"),
        barcode: generateBarcode(product, batch, cartonNo),
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
    });
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
    audit("Production batch generated", { newValue: `${batch}: ${count} cartons`, reason: "Auto-generated padded carton numbers." });
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

  if (backendStatus === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-4 text-slate-950">
        <section className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
            <ShieldCheck size={18} /> Mr Makhana WMS
          </div>
          <h1 className="mt-6 text-2xl font-bold">Loading Supabase data</h1>
          <p className="mt-2 text-sm text-slate-600">{backendMessage}</p>
        </section>
      </main>
    );
  }

  if (backendStatus === "error" && !state.users.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-4 text-slate-950">
        <section className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm ring-1 ring-rose-200">
          <div className="inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            <AlertTriangle size={18} /> Supabase unavailable
          </div>
          <h1 className="mt-6 text-2xl font-bold">Database load failed</h1>
          <p className="mt-2 text-sm text-slate-600">{backendMessage}</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950">
        <section className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex min-h-[520px] flex-col justify-between rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                <ShieldCheck size={18} /> Mr Makhana WMS
              </div>
              <h1 className="mt-8 max-w-xl text-4xl font-bold leading-tight text-slate-950">Carton-level warehouse control for scanning, dispatch, receiving, transfer, and audit.</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                Development Mode is seeded with role-based users, warehouses, cartons, dispatches, mismatch cases, reports, and document slips. Production Mode hides demo operational data for cutover.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Inventory rule" value="Scan only" tone="emerald" />
              <Stat label="Tracking" value="Carton" />
              <Stat label="Roles" value="5" tone="amber" />
            </div>
          </div>
          <form
            className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
            onSubmit={(event) => {
              event.preventDefault();
              login();
            }}
          >
            <h2 className="text-2xl font-bold">Sign in</h2>
            <p className="mt-2 text-sm text-slate-600">{state.settings.mode === "development" ? "Use one of the seeded internal test accounts." : "Production Mode is active. Test account shortcuts are hidden."}</p>
            <div className="mt-6 grid gap-4">
              <TextField label="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
              <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              {loginError ? <div className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{loginError}</div> : null}
              <Button type="submit">
                <Lock size={18} /> Sign in
              </Button>
            </div>
            {state.settings.mode === "development" ? <div className="mt-6 space-y-2 text-xs text-slate-600">
              {state.users.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-2 text-left hover:bg-slate-50"
                  onClick={() => {
                    setEmail(item.email);
                    setPassword(item.password);
                  }}
                >
                  <span className="font-semibold text-slate-800">{item.role}</span>
                  <span>{item.email}</span>
                </button>
              ))}
            </div> : null}
          </form>
        </section>
      </main>
    );
  }

  const nav = [
    ["Dashboard", BarChart3, true],
    ["Scanning", QrCode, can(user, "scan")],
    ["Products", Archive, can(user, "sensitive")],
    ["Import", Upload, can(user, "sensitive")],
    ["Documents", FileText, can(user, "view")],
    ["Reports", Warehouse, can(user, "view")],
    ["Audit", History, user.role !== "Operator"],
    ["Demo Data", Settings, user.role === "Admin"],
    ["Checklist", ClipboardCheck, user.role === "Admin"],
  ] as const;

  const visibleCartons = operationalCartons.filter((carton) => {
    if (user.role === "Admin" || user.role === "Accountant") return true;
    return carton.warehouseId === user.warehouseId || carton.status.includes("IN_TRANSIT");
  });
  const searchMatches = search.trim()
    ? operationalCartons.filter((carton) => carton.barcode.toLowerCase().includes(search.toLowerCase()) || carton.sku.toLowerCase().includes(search.toLowerCase()) || carton.batch.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold">
              <PackageCheck className="text-emerald-700" size={24} /> Mr Makhana WMS
            </div>
            <div className="truncate text-xs font-semibold text-slate-500">
              {user.name} / {user.role} / {warehouseById[user.warehouseId]}
            </div>
            <div className={`mt-1 inline-flex rounded-md px-2 py-1 text-xs font-bold ${state.settings.mode === "development" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
              {state.settings.mode === "development" ? "Development Mode" : "Production Mode"}
            </div>
            <div className={`mt-1 inline-flex rounded-md px-2 py-1 text-xs font-bold ${backendStatus === "error" ? "bg-rose-100 text-rose-800" : backendStatus === "saving" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
              {backendMessage}
            </div>
          </div>
          <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-3 text-slate-400" size={18} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Global barcode search" className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 outline-none focus:border-emerald-700" />
            </div>
            <Button variant="ghost" onClick={logout}>
              <LogOut size={18} /> Logout
            </Button>
          </div>
          <button className="rounded-lg p-2 text-slate-700 md:hidden" onClick={logout} aria-label="Logout">
            <LogOut size={22} />
          </button>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3">
          {nav
            .filter(([, , show]) => show)
            .map(([label, Icon]) => (
              <button key={label} onClick={() => setView(label)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-bold ${view === label ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>
                <Icon size={17} /> {label}
              </button>
            ))}
        </nav>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5">
        {searchMatches.length ? (
          <section className="mb-5 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Search results</h2>
              <Button variant="ghost" onClick={() => setSearch("")}>Clear</Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {searchMatches.slice(0, 6).map((carton) => (
                <CartonRow key={carton.id} carton={carton} warehouse={warehouseById[carton.warehouseId]} product={productById[carton.productId]} onReverse={reverseCarton} canReverse={can(user, "sensitive")} />
              ))}
            </div>
          </section>
        ) : null}

        {view === "Dashboard" ? (
          <section className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Stat label="Active cartons" value={metrics.cartons} tone="emerald" />
              <Stat label="Calculated units" value={metrics.units} />
              <Stat label="In transit" value={metrics.inTransit} tone="amber" />
              <Stat label="Blocked" value={metrics.blocked} tone="rose" />
              <Stat label="Near expiry" value={metrics.nearExpiry} tone="amber" />
              <Stat label="Missing" value={metrics.missing} tone="rose" />
            </div>
            <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">Operational queues</h2>
                  <Button variant="secondary" onClick={() => exportCsv("inventory-snapshot", visibleCartons.map((carton) => ({ barcode: carton.barcode, sku: carton.sku, batch: carton.batch, warehouse: warehouseById[carton.warehouseId], status: carton.status, expiry: carton.expiry })))}>
                    <Download size={18} /> CSV
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <AlertPanel title="Low stock alerts" items={operationalProducts.map((product) => `${product.sku}: ${visibleCartons.filter((carton) => carton.productId === product.id && !lockedStatuses.includes(carton.status)).length} cartons`)} />
                  <AlertPanel title="Near-expiry alerts" items={visibleCartons.filter((carton) => daysFrom(carton.expiry) <= 45).slice(0, 6).map((carton) => `${carton.sku} ${carton.cartonNo}: ${daysFrom(carton.expiry)} days`)} />
                  <AlertPanel title="Pending receipt reminders" items={operationalSessions.filter((item) => item.type === "Factory Dispatch" && item.finalized).slice(0, 4).map((item) => `${item.id}: ${item.scanned.length} cartons dispatched`)} />
                  <AlertPanel title="Duplicate barcode dashboard" items={findDuplicates(operationalCartons.map((carton) => carton.barcode)).map((barcode) => barcode)} />
                </div>
              </section>
              <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-bold">Recent scans and actions</h2>
                <div className="mt-4 space-y-3">
                  {state.audit.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm font-bold">{item.action}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-500">{item.barcode ?? item.documentRef ?? item.newValue}</div>
                      <div className="mt-1 text-xs text-slate-500">{new Date(item.time).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {view === "Scanning" ? (
          <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-bold">Scan workflow</h2>
              <div className="mt-4 grid gap-2">
                {(["Factory Dispatch", "Warehouse Receive", "Transfer Out", "Transfer In", "Customer Dispatch"] as ScanSession["type"][]).map((type) => (
                  <Button key={type} variant={session?.type === type ? "primary" : "secondary"} onClick={() => startSession(type)} disabled={!can(user, "scan")}>
                    {type.includes("Dispatch") ? <Truck size={18} /> : <ArrowRightLeft size={18} />} {type}
                  </Button>
                ))}
              </div>
              <div className="mt-5">
                <h3 className="text-sm font-bold uppercase text-slate-500">Saved drafts</h3>
                <div className="mt-2 space-y-2">
                  {operationalSessions.filter((item) => !item.finalized).length ? operationalSessions.filter((item) => !item.finalized).map((item) => (
                    <button key={item.id} onClick={() => resumeDraft(item.id)} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50">
                      <div className="font-bold">{item.type}</div>
                      <div className="text-xs text-slate-500">{item.scanned.length} scans / {new Date(item.updatedAt).toLocaleString()}</div>
                    </button>
                  )) : <EmptyState text="No saved scan drafts." />}
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              {session ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold">{session.type}</h2>
                      <p className="text-sm text-slate-500">{warehouseById[session.sourceWarehouseId]} -&gt; {session.destinationWarehouseId ? warehouseById[session.destinationWarehouseId] : session.customer ?? "Customer"}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold uppercase text-slate-500">Scanned</div>
                      <div className="text-3xl font-bold text-emerald-700">{session.scanned.length}</div>
                      {session.expected?.length ? <div className="text-xs font-semibold text-slate-500">Expected {session.expected.length}</div> : null}
                    </div>
                  </div>
                  {session.type === "Warehouse Receive" || session.type === "Transfer In" ? (
                    <div className="mt-4">
                      <SelectField label="Source dispatch / transfer" value={session.sourceSessionId ?? ""} onChange={(event) => updateSourceSession(event.target.value)}>
                        <option value="">Select source session</option>
                        {(session.type === "Warehouse Receive" ? sourceSessions.receiving : sourceSessions.transferIn).map((item) => (
                          <option key={item.id} value={item.id}>{item.id} / {item.scanned.length} cartons / {new Date(item.updatedAt).toLocaleString()}</option>
                        ))}
                      </SelectField>
                    </div>
                  ) : null}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <TextField label="Vehicle number" value={session.vehicle ?? ""} onChange={(event) => setSession({ ...session, vehicle: event.target.value, updatedAt: now() })} />
                    <TextField label="Driver name" value={session.driver ?? ""} onChange={(event) => setSession({ ...session, driver: event.target.value, updatedAt: now() })} />
                    <TextField label="LR / docket" value={session.lr ?? ""} onChange={(event) => setSession({ ...session, lr: event.target.value, updatedAt: now() })} />
                    <TextField label="Transporter" value={session.transporter ?? ""} onChange={(event) => setSession({ ...session, transporter: event.target.value, updatedAt: now() })} />
                    <SelectField label="Destination" value={session.destinationWarehouseId ?? ""} onChange={(event) => setSession({ ...session, destinationWarehouseId: event.target.value, updatedAt: now() })}>
                      <option value="">Customer / not applicable</option>
                      {state.warehouses.filter((item) => item.type === "warehouse").map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                    </SelectField>
                    <TextField label="Customer" value={session.customer ?? ""} onChange={(event) => setSession({ ...session, customer: event.target.value, updatedAt: now() })} />
                  </div>
                  <form
                    className="mt-5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleScan(scanInput);
                    }}
                  >
                    <label className="grid gap-2 text-sm font-bold text-slate-700">
                      USB/Bluetooth scanner input
                      <input ref={scanRef} value={scanInput} onChange={(event) => setScanInput(event.target.value)} className="h-16 rounded-xl border-2 border-emerald-700 px-4 font-mono text-lg outline-none" placeholder="Scan barcode and press Enter" />
                    </label>
                  </form>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setCameraOn((value) => !value)}><Camera size={18} /> Camera</Button>
                    <Button variant="secondary" onClick={undoLastScan}>Undo last scan</Button>
                    <Button variant="secondary" onClick={saveDraft}>Save draft</Button>
                    <Button onClick={finalizeSession} disabled={session.scanned.length === 0}><CheckCircle2 size={18} /> Finalize</Button>
                  </div>
                  {scanMessage ? <div className={`mt-4 rounded-lg p-3 text-sm font-bold ${scanMessage.type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{scanMessage.text}</div> : null}
                  {cameraOn ? <CameraScanner onScan={handleScan} /> : null}
                  <div className="mt-5 max-h-[360px] space-y-2 overflow-auto">
                    {session.scanned.map((barcode) => {
                      const carton = operationalCartons.find((item) => item.barcode === barcode);
                      return carton ? <CartonRow key={barcode} carton={carton} warehouse={warehouseById[carton.warehouseId]} product={productById[carton.productId]} /> : null;
                    })}
                  </div>
                </>
              ) : (
                <EmptyState text="Start a scan workflow to begin. Inventory movement is locked until finalization." />
              )}
            </div>
          </section>
        ) : null}

        {view === "Products" ? (
          <ProductsPanel products={operationalProducts} onAddProduct={addProduct} onGenerateBatch={generateBatch} />
        ) : null}

        {view === "Import" ? (
          <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-bold">Excel barcode import</h2>
              <p className="mt-2 text-sm text-slate-600">Columns accepted: barcode_value, sku, batch, mfd, expiry, mrp, carton_quantity, carton_number, current_warehouse.</p>
              <input className="mt-4 w-full rounded-lg border border-slate-300 p-3" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && importExcel(event.target.files[0])} />
              <Button className="mt-3 w-full" variant="secondary" onClick={() => exportCsv("import-errors", importErrors.map((error) => ({ error })))}>
                <Download size={18} /> Download error report
              </Button>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-bold">Rejected records</h2>
              <div className="mt-3 space-y-2">
                {importErrors.length ? importErrors.map((error) => <div key={error} className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div>) : <EmptyState text="No import errors in the latest file." />}
              </div>
            </div>
          </section>
        ) : null}

        {view === "Documents" ? (
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
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
          </section>
        ) : null}

        {view === "Reports" ? (
          <section className="grid gap-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {state.warehouses.map((warehouse) => <Stat key={warehouse.id} label={warehouse.name} value={visibleCartons.filter((carton) => carton.warehouseId === warehouse.id).length} />)}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <ReportTable title="Inventory by SKU, batch, expiry, status" rows={visibleCartons.map((carton) => ({ barcode: carton.barcode, sku: carton.sku, batch: carton.batch, expiry: carton.expiry, warehouse: warehouseById[carton.warehouseId], status: carton.status }))} />
              <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-bold">Shortage and investigation cases</h2>
                <div className="mt-4 space-y-3">
                  {operationalMismatches.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-bold">{item.id}</div>
                        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{item.status}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-600">Missing {item.missing.length} / Extra {item.extra.length} / Duplicate {item.duplicates.length}</div>
                      {can(user, "sensitive") && item.status === "Open" ? <MismatchApproval onApprove={(reason) => approveMismatch(item.id, reason)} /> : null}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {view === "Audit" ? (
          <ReportTable title="User activity and audit logs" rows={state.audit.map((item) => ({ time: item.time, user: state.users.find((entry) => entry.id === item.userId)?.name, role: item.role, action: item.action, barcode: item.barcode, document: item.documentRef, old: item.oldValue, new: item.newValue, reason: item.reason }))} />
        ) : null}

        {view === "Demo Data" ? (
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
      </div>
    </main>
  );
}

function AlertPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2 font-bold"><AlertTriangle size={18} className="text-amber-600" /> {title}</div>
      <div className="mt-3 space-y-2">
        {items.length ? items.map((item) => <div key={item} className="rounded-md bg-slate-50 p-2 text-sm text-slate-700">{item}</div>) : <EmptyState text="Nothing pending." compact />}
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
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">System Mode</h2>
            <p className="mt-1 text-sm text-slate-600">Development Mode keeps UAT demo workflows visible. Production Mode hides demo operational records and shows only real business data.</p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-sm font-bold ${mode === "development" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {mode === "development" ? "Development Mode" : "Production Mode"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={mode === "development" ? "primary" : "secondary"} onClick={() => onSetMode("development")}>Development Mode</Button>
          <Button variant={mode === "production" ? "primary" : "secondary"} onClick={() => onSetMode("production")}>Production Mode</Button>
        </div>
        {goLiveAt ? <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Go Live completed at {new Date(goLiveAt).toLocaleString()}</div> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Demo products" value={demoCounts.products} />
        <Stat label="Demo cartons" value={demoCounts.cartons} />
        <Stat label="Demo sessions" value={demoCounts.sessions} />
        <Stat label="Demo documents" value={demoCounts.documents} />
        <Stat label="Demo cases" value={demoCounts.mismatches} />
        <Stat label="Archived demo" value={demoCounts.archived} tone={demoCounts.archived ? "amber" : "slate"} />
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-bold">Production Cutover Tool</h2>
        <p className="mt-1 text-sm text-slate-600">Go Live archives demo inventory, products, dispatches, reports, and mismatch cases, then switches to Production Mode. Users, warehouses, barcode templates, audit logs, and configuration are preserved.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto_auto]">
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reason for demo data action" className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm" />
          <Button variant="secondary" disabled={!reason.trim() || demoTotal === 0} onClick={() => onArchive(reason)}>Archive Demo Data</Button>
          <Button variant="secondary" disabled={!reason.trim() || demoTotal === 0} onClick={() => onRestore(reason)}>Restore Demo Data</Button>
          <Button disabled={!reason.trim()} onClick={() => onGoLive(reason)}><CheckCircle2 size={18} /> Go Live</Button>
          <Button variant="danger" disabled={!reason.trim() || demoTotal === 0} onClick={() => onDelete(reason)}>Delete Permanently</Button>
        </div>
      </section>

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
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="font-bold">{title}</h3>
      <div className="mt-3 max-h-[420px] space-y-2 overflow-auto">
        {rows.length ? rows.map((row) => <div key={row} className="rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-700">{row}</div>) : <EmptyState text="No demo records." compact />}
      </div>
    </div>
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
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Pre-launch Checklist</h2>
          <p className="mt-1 text-sm text-slate-600">Use this during UAT. A red item means the workflow still needs real-data testing before cutover.</p>
        </div>
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{checks.filter((item) => item.ok).length}/{checks.length} ready</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {checks.map((item) => (
          <div key={item.label} className={`rounded-lg border p-3 ${item.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-2 font-bold">
              {item.ok ? <CheckCircle2 size={18} className="text-emerald-700" /> : <AlertTriangle size={18} className="text-amber-700" />}
              {item.label}
            </div>
            <div className="mt-1 text-sm text-slate-600">{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
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
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-bold text-slate-950">{carton.barcode}</div>
          <div className="mt-1 text-sm font-bold">{carton.sku} / {product?.flavour ?? carton.flavour} / {carton.cartonNo}</div>
          <div className="mt-1 text-xs text-slate-500">{warehouse} / Batch {carton.batch} / Exp {carton.expiry}</div>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${lockedStatuses.includes(carton.status) ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>{carton.status}</span>
      </div>
      {canReverse && onReverse ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reversal reason" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
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
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-bold">{doc.type}</div>
          <div className="font-mono text-xs text-slate-500">{doc.id}</div>
        </div>
        <FileText className="text-emerald-700" />
      </div>
      <div className="mt-3 text-sm text-slate-600">{doc.source ?? "-"} -&gt; {doc.destination ?? "-"}</div>
      <div className="mt-1 text-sm font-semibold">{doc.barcodes.length} cartons</div>
      {doc.discrepancy ? <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800">{doc.discrepancy}</div> : null}
      <div className="mt-3 grid gap-2">
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory reprint reason" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
        <Button variant="secondary" disabled={!reason.trim()} onClick={() => onReprint(doc, reason)}><Printer size={18} /> PDF / reprint</Button>
      </div>
    </div>
  );
}

function ProductsPanel({ products, onAddProduct, onGenerateBatch }: { products: Product[]; onAddProduct: (form: FormData) => void; onGenerateBatch: (productId: string, batch: string, count: number) => void }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [batch, setBatch] = useState("B2607A");
  const [count, setCount] = useState(12);
  return (
    <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
      <form
        className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
        onSubmit={(event) => {
          event.preventDefault();
          onAddProduct(new FormData(event.currentTarget));
          event.currentTarget.reset();
        }}
      >
        <h2 className="text-lg font-bold">Product creation wizard</h2>
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
        <TextField name="template" label="Barcode template" required defaultValue={barcodeTemplate} className="mt-4 font-mono text-xs" />
        <Button type="submit" className="mt-4"><Archive size={18} /> Create product</Button>
      </form>
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-bold">Batch / carton generation</h2>
        <div className="mt-4 grid gap-3">
          <SelectField label="Product" value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} / {item.flavour}</option>)}</SelectField>
          <TextField label="Batch" value={batch} onChange={(event) => setBatch(event.target.value)} />
          <TextField label="Carton count" type="number" value={count} onChange={(event) => setCount(Number(event.target.value))} />
          <Button onClick={() => onGenerateBatch(productId, batch, count)}><Printer size={18} /> Generate cartons and labels</Button>
        </div>
        <div className="mt-5 space-y-2">
          {products.map((product) => (
            <div key={product.id} className="rounded-lg border border-slate-200 p-3">
              <div className="font-bold">{product.sku}</div>
              <div className="text-sm text-slate-500">{product.flavour} / {product.caseQty}{product.qtyUnit} / MRP {product.mrp}</div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function ReportTable({ title, rows }: { title: string; rows: Record<string, string | number | undefined>[] }) {
  const headers = Object.keys(rows[0] ?? { empty: "" });
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <Button
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
      <div className="mt-4 overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {headers.map((header) => <th key={header} className="p-3 font-bold capitalize text-slate-600">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((row, index) => (
              <tr key={index} className="border-b border-slate-100">
                {headers.map((header) => <td key={header} className="max-w-[260px] truncate p-3">{row[header]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-sm font-semibold text-slate-500 ${compact ? "p-3" : "p-8"}`}>{text}</div>;
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
