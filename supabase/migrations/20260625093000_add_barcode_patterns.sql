alter table public.products drop constraint if exists products_gtin_key;

create table if not exists public.barcode_patterns (
  id text primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  prefix text not null,
  gtin text not null,
  batch_pattern text not null,
  weight text not null,
  case_qty integer not null check (case_qty > 0),
  qty_unit text not null check (qty_unit in ('pcs', 'pc', 'p')),
  mrp numeric(10,2) not null,
  variant_code text not null,
  barcode_template text not null,
  example_barcode text not null,
  carton_range_start text not null default '00001',
  carton_range_end text not null default '99999',
  data_origin text not null default 'real' check (data_origin in ('demo', 'real', 'system')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.barcode_patterns enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'barcode_patterns'
      and policyname = 'read barcode patterns'
  ) then
    create policy "read barcode patterns" on public.barcode_patterns for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'barcode_patterns'
      and policyname = 'admin accountant write barcode patterns'
  ) then
    create policy "admin accountant write barcode patterns" on public.barcode_patterns for all to authenticated using (public.is_admin_or_accountant()) with check (public.is_admin_or_accountant());
  end if;
end $$;
