# Mr Makhana WMS

Mobile-first carton-level warehouse management for Mr Makhana inventory, barcode scanning, dispatch, receiving, transfer, customer dispatch, investigation cases, audit, reports, and printable slips.

## Current Build

The app is deployed on Vercel and runs as a full audited demo WMS in browser storage. Supabase is provisioned, seeded, and configured in Vercel for the next backend wiring pass. The production database contract and RLS policies are in `supabase/schema.sql`.

- Live app: https://mrmakhana-wms.vercel.app/
- GitHub repo: https://github.com/ridhjainrj/mrmakhana-wms
- Vercel project: `ridh-s-projects/mrmakhana-wms`
- Supabase project: `yagdnrnfqbqcqgcbejuc` (`mrmakhana-wms`, `ap-south-1`)

Implemented:

- UAT system mode switch for Development Mode and Production Mode
- Demo data separation with `demo`, `real`, and `system` origin flags
- Admin Demo Data Manager with view, archive, restore, and permanent delete actions
- Production Cutover Tool with a single Go Live action that archives demo operational data
- Pre-launch checklist for Supabase, inventory, dispatch, receiving, transfers, reports, PDFs, barcode scanning, and production readiness
- Role-based login and menus for Admin, Accountant, Warehouse Manager, Operator, Viewer
- Carton-level inventory with unique barcode assets and lifecycle timeline through audit records
- USB/Bluetooth scanner input with auto-focus and Enter processing
- Camera scanner support where browser camera permissions are available
- Barcode template parsing with `pcs`, `pc`, and `p` quantity formats
- Excel import with duplicate/invalid rejection and downloadable error report
- Product creation wizard and production batch/carton generation with padded carton numbers
- Dispatch, receiving, transfer, and customer dispatch scan sessions
- Duplicate, wrong location, expired, damaged, blocked, and invalid-status scan blocking
- Draft scan sessions, resume, undo last scan, 30-minute inactive auto-lock
- Mismatch cases and Admin/Accountant shortage approval
- PDF slips with document number, QR reference, carton count, SKU/batch summary, barcodes, vehicle/driver/LR, discrepancies
- CSV exports for reports
- Low stock, near-expiry, pending receipt, duplicate barcode, missing carton dashboards
- Mandatory reasons for reversal and shortage/write-off approvals
- Audit logs for important inventory actions
- Automated release tests for role rules, barcode formats, scan blocking, receiving source enforcement, finalization requirements, and customer dispatch checks

## Test Credentials

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@mrmakhana.test` | `Admin@123` |
| Accountant | `accountant@mrmakhana.test` | `Account@123` |
| Warehouse Manager | `manager@mrmakhana.test` | `Manager@123` |
| Operator | `operator@mrmakhana.test` | `Operator@123` |
| Viewer | `viewer@mrmakhana.test` | `Viewer@123` |

## UAT Mode And Cutover

The application is currently in UAT. Demo, seed, and test data are intentionally retained for workflow testing, barcode testing, dispatch testing, receiving testing, transfer testing, approval testing, document generation testing, and role testing.

Admin users can open **Demo Data** to switch between:

- **Development Mode**: demo products, seeded inventory, sample workflows, and test users stay visible for UAT.
- **Production Mode**: demo products, sample inventory, sample dispatches, sample reports, and archived demo records are hidden from operational screens so only real business data is shown.

The **Go Live** action archives demo inventory, demo products, demo dispatches, demo reports, scan sessions, and mismatch cases while preserving system settings, users, warehouses, barcode templates, audit logs, and configuration. Real Excel imports and real generated batches are tagged as real data and remain visible after cutover.

Do not permanently delete demo data until Supabase wiring, Excel import, barcode workflows, reports, PDF slips, and all warehouse flows have passed UAT.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Supabase Status

Completed:

- Created Supabase organization `Mr Makhana`
- Created project `mrmakhana-wms` in `ap-south-1`
- Applied `supabase/schema.sql`
- Verified public tables and RLS policies
- Created test Auth users and matching `public.profiles`
- Seeded warehouses, products, cartons, a factory dispatch, documents, mismatch case, and audit records
- Added production Vercel env vars:

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

The current frontend still uses the audited browser demo store. Supabase is ready for replacing the local reducer with Supabase queries/server actions.

## Release Checks

Run these before every deployment:

```bash
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Latest audited release passed all four checks and was deployed with `vercel --prod`.
