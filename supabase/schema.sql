create type public.app_role as enum ('Admin', 'Accountant', 'Warehouse Manager', 'Operator', 'Viewer');
create type public.carton_status as enum (
  'IN_FACTORY',
  'DISPATCH_PENDING',
  'IN_TRANSIT',
  'RECEIVED_AT_WAREHOUSE',
  'TRANSFER_PENDING',
  'IN_TRANSIT_TRANSFER',
  'RECEIVED_AT_DESTINATION',
  'DISPATCHED_TO_CUSTOMER',
  'DELIVERED',
  'DAMAGED',
  'LOST',
  'BLOCKED',
  'EXPIRED',
  'UNDER_INVESTIGATION',
  'VOIDED',
  'REVERSED'
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('factory', 'warehouse', 'transit')),
  created_at timestamptz not null default now()
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null default 'Viewer',
  warehouse_id uuid references public.warehouses(id),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  flavour text not null,
  category text not null,
  sku text not null unique,
  gtin text not null unique,
  prefix text not null,
  weight text not null,
  mrp numeric(10,2) not null,
  case_qty integer not null check (case_qty > 0),
  qty_unit text not null check (qty_unit in ('pcs', 'pc', 'p')),
  variant_code text not null,
  shelf_life_days integer not null check (shelf_life_days > 0),
  hsn text,
  status text not null default 'Active' check (status in ('Active', 'Blocked')),
  barcode_template text not null default '{PREFIX}{GTIN}{BATCH}{WEIGHT}{QTY}{QTY_UNIT}{MRP}{VARIANT}{CARTON_NO}',
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.cartons (
  id uuid primary key default gen_random_uuid(),
  barcode_value text not null unique,
  product_id uuid not null references public.products(id),
  sku text not null,
  gtin text not null,
  flavour text not null,
  weight text not null,
  mrp numeric(10,2) not null,
  carton_quantity integer not null check (carton_quantity > 0),
  qty_unit text not null check (qty_unit in ('pcs', 'pc', 'p')),
  batch text not null,
  mfd date not null,
  expiry date not null,
  carton_no text not null,
  current_warehouse_id uuid references public.warehouses(id),
  current_status public.carton_status not null,
  customer text,
  blocked_reason text,
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  session_type text not null,
  source_warehouse_id uuid references public.warehouses(id),
  destination_warehouse_id uuid references public.warehouses(id),
  source_session_id uuid references public.scan_sessions(id),
  customer text,
  vehicle_number text,
  driver_name text,
  lr_docket text,
  transporter text,
  notes text,
  expected_barcodes text[] not null default '{}',
  scanned_barcodes text[] not null default '{}',
  finalized boolean not null default false,
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id text primary key,
  document_type text not null,
  source text,
  destination text,
  vehicle_number text,
  driver_name text,
  lr_docket text,
  transporter text,
  notes text,
  discrepancy text,
  barcode_values text[] not null default '{}',
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_by uuid references public.profiles(id),
  approver uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.mismatch_cases (
  id text primary key,
  session_id uuid references public.scan_sessions(id),
  status text not null default 'Open',
  missing_barcodes text[] not null default '{}',
  extra_barcodes text[] not null default '{}',
  duplicate_barcodes text[] not null default '{}',
  reason text,
  approved_by uuid references public.profiles(id),
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  role public.app_role not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  barcode_value text,
  document_ref text,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.app_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_warehouse_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select warehouse_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin_or_accountant()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_role() in ('Admin', 'Accountant')
$$;

create or replace function public.is_manager_or_above()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_role() in ('Admin', 'Accountant', 'Warehouse Manager')
$$;

alter table public.warehouses enable row level security;
alter table public.system_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.cartons enable row level security;
alter table public.scan_sessions enable row level security;
alter table public.documents enable row level security;
alter table public.mismatch_cases enable row level security;
alter table public.audit_logs enable row level security;

create policy "read warehouses" on public.warehouses for select to authenticated using (true);
create policy "manage warehouses" on public.warehouses for all to authenticated using (public.current_role() = 'Admin') with check (public.current_role() = 'Admin');

create policy "read system settings" on public.system_settings for select to authenticated using (true);
create policy "admin manages system settings" on public.system_settings for all to authenticated using (public.current_role() = 'Admin') with check (public.current_role() = 'Admin');

create policy "read own profile or privileged" on public.profiles for select to authenticated using (id = auth.uid() or public.current_role() in ('Admin', 'Accountant'));
create policy "admin manages profiles" on public.profiles for all to authenticated using (public.current_role() = 'Admin') with check (public.current_role() = 'Admin');

create policy "read products" on public.products for select to authenticated using (true);
create policy "admin accountant write products" on public.products for all to authenticated using (public.is_admin_or_accountant()) with check (public.is_admin_or_accountant());

create policy "read allowed cartons" on public.cartons for select to authenticated using (
  public.current_role() in ('Admin', 'Accountant')
  or current_warehouse_id = public.current_warehouse_id()
  or current_status in ('IN_TRANSIT', 'IN_TRANSIT_TRANSFER')
);

create policy "privileged carton writes only" on public.cartons for update to authenticated using (public.is_manager_or_above()) with check (
  public.is_manager_or_above()
  and (
    public.is_admin_or_accountant()
    or current_status not in ('DAMAGED', 'LOST', 'BLOCKED', 'EXPIRED', 'VOIDED', 'REVERSED', 'UNDER_INVESTIGATION')
  )
);

create policy "admin accountant create cartons" on public.cartons for insert to authenticated with check (public.is_admin_or_accountant());

create policy "read scan sessions" on public.scan_sessions for select to authenticated using (
  public.current_role() in ('Admin', 'Accountant')
  or created_by = auth.uid()
  or source_warehouse_id = public.current_warehouse_id()
  or destination_warehouse_id = public.current_warehouse_id()
);
create policy "create scan sessions" on public.scan_sessions for insert to authenticated with check (public.current_role() <> 'Viewer');
create policy "update own scan drafts" on public.scan_sessions for update to authenticated using (created_by = auth.uid() and finalized = false) with check (created_by = auth.uid());

create policy "read documents" on public.documents for select to authenticated using (true);
create policy "create documents manager above" on public.documents for insert to authenticated with check (public.is_manager_or_above());

create policy "read mismatch cases" on public.mismatch_cases for select to authenticated using (public.current_role() <> 'Operator');
create policy "create mismatch cases" on public.mismatch_cases for insert to authenticated with check (public.is_manager_or_above());
create policy "approve mismatch cases" on public.mismatch_cases for update to authenticated using (public.is_admin_or_accountant()) with check (public.is_admin_or_accountant());

create policy "read audit logs privileged" on public.audit_logs for select to authenticated using (public.current_role() in ('Admin', 'Accountant', 'Warehouse Manager', 'Viewer'));
create policy "append audit logs" on public.audit_logs for insert to authenticated with check (auth.uid() = user_id);

insert into public.warehouses (name, type) values
  ('Factory', 'factory'),
  ('Delhi Warehouse', 'warehouse'),
  ('Mumbai Warehouse', 'warehouse'),
  ('In Transit', 'transit')
on conflict (name) do nothing;

insert into public.system_settings (key, value) values
  ('app_mode', '{"mode":"development","phase":"uat"}'::jsonb),
  ('supabase_project_ref', '{"project_ref":"yagdnrnfqbqcqgcbejuc"}'::jsonb)
on conflict (key) do nothing;
