# Mr Makhana WMS

Mobile-first carton-level warehouse management for Mr Makhana inventory, barcode scanning, dispatch, receiving, transfer, customer dispatch, investigation cases, audit, reports, and printable slips.

## Current Build

The app is deployed on Vercel and runs as a full audited demo WMS in browser storage until live Supabase credentials are connected. The production database contract and RLS policies are in `supabase/schema.sql`.

- Live app: https://mrmakhana-wms.vercel.app/
- GitHub repo: https://github.com/ridhjainrj/mrmakhana-wms
- Vercel project: `ridh-s-projects/mrmakhana-wms`

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

## Production Supabase Setup

The Supabase CLI is installed, but this non-TTY shell needs an access token:

```bash
$env:SUPABASE_ACCESS_TOKEN="sbp_..."
supabase projects list
```

After the token is available:

1. Create/link the Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor or via `supabase db push`.
3. Create Auth users for the test roles.
4. Insert matching rows in `public.profiles` with each Auth user id and the correct role.
5. Add these environment variables to Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The current app is demo-storage backed. The schema is ready for replacing the local reducer with Supabase queries/server actions once project keys are available.

## Release Checks

Run these before every deployment:

```bash
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Latest audited release passed all four checks and was deployed with `vercel --prod`.
