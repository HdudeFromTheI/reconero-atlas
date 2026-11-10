# Reconero Atlas — private nationwide agency outreach tracker

A searchable, mobile-friendly website for tracking outreach to U.S. law-enforcement agencies, deployable on **GitHub Pages**. It uses **Supabase Auth + Postgres** for real password authentication and a shared, persistent database.

**Features**

- Search by agency name or FBI ORI; filter by **state**, **agency type**, and **outreach activity**.
- Independent **Cold call**, **Cold email**, and **LinkedIn** checkboxes per agency, auto-saved to a shared database.
- Pipeline status, follow-up date, contact name/email/phone, personalization angle and its source, and notes.
- Import the open FBI-derived nationwide roster (~19,636 agencies in 50 states + DC) from a CSV.
- Bulk mark previously contacted departments after previewing **exact agency-name matches**.
- Export CSV backups of records with outreach progress.
- Login protected with Supabase password authentication, allowlisted accounts, and database **Row Level Security** (RLS).
- Data stays in Supabase, **not** in browser localStorage. Changing devices or signing in as another authorized team member shows the same saved information.

## What it does *not* promise

There is no permanently exhaustive, always-current public list of every active police department in the USA. This project uses the FBI's Crime Data Explorer agency directory, distributed as a CC0 CSV by IROPO. It is a **broad law-enforcement roster**, including sheriffs' offices, state police, tribal agencies and special jurisdictions in addition to municipal departments. Some entries may be inactive or missing. The 2026 roster has 19,636 entries as reported by its publisher. **It does not contain contact names, personal email addresses, or verified deliverability information.**

Source: https://iropo.org/sources/ (FBI directory retrieved Sept. 30, 2026).
BJS census context: https://bjs.ojp.gov/data-collection/census-state-and-local-law-enforcement-agencies-csllea

## One-time setup (no programming required)

### 1. Create the shared database

1. Create a Supabase project at https://supabase.com/dashboard (free tier may be sufficient for this small project, subject to Supabase's current plan limits).
2. Go to **SQL Editor** → **New query**. Open `schema.sql` from this project, copy the entire contents, and click **Run**.
3. This creates the agency records table, allowlist table, permissions, security functions and RLS policies. The database contains **zero** agencies until you import the roster.

### 2. Make your private user account

1. In Supabase, go to **Authentication → Providers → Email**. Use email/password authentication. **Disable public user signup** (often under **Authentication → Settings → User Signups**; menus may vary).
2. Under **Authentication → Users**, choose **Add user** and manually create your user account and password. If needed, confirm the email account in that panel.
3. Copy that user's **UUID** from the Supabase Users table. **Don't use the email address where a UUID is expected.**
4. Go to **SQL Editor** and run this with your UUID:

```sql
insert into public.reconero_members (user_id)
values ('YOUR-USER-UUID-HERE')
on conflict do nothing;
```

The allowlist is crucial: being signed into Supabase alone does **not** grant access. This site checks membership server-side and database RLS blocks all agency reads/writes from non-members. To add an authorized teammate later, manually create their Auth user and add their UUID to `reconero_members`. To revoke someone, remove their row from `reconero_members`, and preferably disable/delete their Auth account too.

### 3. Connect the website to Supabase

1. In Supabase project settings, copy your **Project URL** and **publishable** (or legacy **anon**) API key.
2. Open `config.js`, replace the two `PASTE_…` placeholders with these values, and save.
3. **NEVER put your service_role key or any `sb_secret_...` key in `config.js`, a GitHub repo or browser code.** The publishable/anon key is *designed to be public*. The password and database rules are the security boundary.

### 4. Publish on GitHub Pages

1. Create a GitHub repository, e.g. `reconero-atlas`.
2. Add **all** files and folders from this project (`index.html`, `schema.sql`, `config.js`, `assets/`, etc.) to the root of your repository. Keep your password out of the repo.
3. In GitHub, open **Settings → Pages**. Choose **Deploy from a branch**, `main`, root `/`, and save.
4. Visit `https://YOUR-GITHUB-USERNAME.github.io/reconero-atlas/` when GitHub Pages publishes it.
5. Sign in with the Supabase user you created.

**Security distinction:** GitHub Pages serves your HTML/JavaScript publicly, so anyone can view the login screen or frontend source. However, your **agency records, notes and checkboxes are protected in Supabase by RLS**, and are not embedded in the static website. Do not store confidential contact lists, passwords, or secrets as public static files in the repository. If you require hiding the *existence or source code* of the website too, use an authenticated hosting platform rather than public GitHub Pages.

### 5. Import the nationwide agency directory

1. In the website, click **Import agencies**.
2. Click **Download nationwide agencies.csv** (the CSV from https://iropo.org/data/agencies.csv).
3. Select that downloaded CSV in the website. Confirm the suggested ORI, name, state, county and type column mappings.
4. Click **Import to shared database**. **Keep the browser tab open until it finishes.** It uploads the roster to Supabase in small batches. This can take some time for ~19,636 rows.
5. Go back to **Agency directory**. Search any department or choose a state filter.

Import is **idempotent and safe for existing notes**: records with existing ORIs are skipped rather than overwritten. You can import again if the first import was interrupted.

### 6. Record the 39 emails you previously sent

If you used the original 50-contact GMass file and the **first 39 recipients** actually sent, use the separately provided `Reconero_Prior_Campaign_First39_REVIEW.csv` (it's **not** included in the website repo). **Compare it with your GMass delivery report first**: list ordering may differ.

1. Click **Bulk mark outreach** in the website.
2. Choose **CA** and upload that CSV (or paste the department names).
3. Click **Preview matches**. The site matches **normalized exact agency names**, shows matches, and **skips** ambiguous/missing names.
4. Verify the preview and click **Mark matched as emailed**. This changes the corresponding saved checkboxes without sending any new emails. Review any unmatched agencies manually.

**Note:** An opening or click is *not* an email reply. Use the status/notes field to track actual conversations.

## Day-to-day use

- Click a checkbox in the table to record an outreach method; it is saved immediately in Supabase.
- Click **Details** to change the stage, follow-up date, contact details, notes, and sourced personalization.
- Filter to `Not contacted`, `Cold emailed`, `Any outreach`, or `Follow-up due` to manage your work.
- Use **Export progress** for a CSV backup of agencies with actual tracked work.
- Team members you explicitly authorize see the same saved data on any computer. They may need to refresh to see other users' recent edits.

## File list

```
index.html           Site layout and login screen
config.js            Public Supabase URL / publishable key — edit before deploying
schema.sql           Database tables and security rules — run in Supabase
assets/styles.css    Responsive dark styling
assets/app.js        Authentication, search, checkboxes, import, editor
assets/favicon.svg   Favicon
README.md            These setup instructions
```

## Common questions

**Can I host this entirely on GitHub without Supabase?** Not securely with persistent shared data. GitHub Pages is static; a hardcoded password in JavaScript and browser localStorage would be insecure and wouldn't synchronize across devices.

**Why can't I see an agency immediately after login?** The source roster is not bundled into the public site to avoid exposing the exact prospect set or installing a backend database for you without credentials. Import the public CSV once after logging in.

**Will this work with multiple users?** Yes. Add each person via Supabase Auth and manually allowlist their UUID. All authorized users share the same agency records. Do not reuse one password across users.

**How do I keep records private?** Keep your Supabase account and user password secure, enforce RLS, disable self-registration, and don't commit real outreach CSVs to a public GitHub repository. You may also enable MFA if available on your Supabase Auth setup.

**Why are some cities missing?** FBI agency rosters are not guaranteed complete or current. Use **Add agency** for missing departments and give them your own notes/contacts.

## Sources and dependencies

- Agency roster: https://iropo.org/sources/ — FBI Crime Data Explorer directory, public domain / CC0 distribution; ~19,636 as of September 2026.
- Authentication: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Row-level authorization: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase JS client: https://supabase.com/docs/reference/javascript/installing
- Papa Parse for CSV: https://www.papaparse.com/

This is a starter app, not an independently security-audited production system. Review security and Supabase plan limits before storing sensitive information.
