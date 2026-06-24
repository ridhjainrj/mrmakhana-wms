# Mr Makhana WMS

Mobile-first carton-level warehouse management for Mr Makhana inventory, barcode scanning, dispatch, receiving, transfer, customer dispatch, investigation cases, audit, reports, and printable slips.

## Current Build

The app is deployed on Vercel and runs as a full audited demo WMS in browser storage. Supabase is provisioned, seeded, and configured in Vercel for the next backend wiring pass. The production database contract and RLS policies are in `supabase/schema.sql`.

- Live app: https://mrmakhana-wms.vercel.app/
- GitHub repo: https://github.com/ridhjainrj/mrmakhana-wms
- Vercel project: `ridh-s-projects/mrmakhana-wms`
- Supabase project: `yagdnrnfqbqcqgcbejuc` (`mrmakhana-wms`, `ap-south-1`)

Implemented:

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
