# wOrder

## Supabase: which project is which

Use the `supabase-pat` MCP server. It authenticates with a Personal Access Token and sees every
organisation on the account. Pick the project from context. Don't ask when the table below answers
it, and always pass `project_id` explicitly.

| Organisation | Project | Ref | Used by |
|---|---|---|---|
| tonybeo11-8257's projects (Vercel integration) | **wOrder** | `cjrzeoswkzenwlftsahp` | This repo (`VITE_SUPABASE_URL`) |
| tonybeo11-8257's projects | clock | `rbhfkkszspridhmyjqqz` | Inactive |
| tonybeo11-8257's projects | todo | `hibujxccmghelexjjzis` | – |
| woso | **PersonalKollen** | `feitxkffysbranglghsr` | Schema app (github `babyem/schema`); this repo's `src/plugins/schema/` (`VITE_SCHEMA_SUPABASE_URL`) |
| woso | Beställning | `jdfymvbgzrporuyyjapm` | – |
| woso | B2Border | `hwjnjzdzsmnfmyqnwrqa` | – |
| woso | kiosk | `ypombqxksumfrkchdaym` | – |
| amex | (no projects) | – | – |

How to resolve:
- The context mentions shifts, the schedule, staff, `shifts`/`employees`/`shift_types`, or Schema/TodayRoster → **PersonalKollen**.
- The context mentions orders, vendors, locations, order_send_log, or `supabase/migrations/` in this repo → **wOrder**.
- A project that isn't in the table: run `list_projects` and match on name before assuming anything.
- If `supabase-pat` is missing, the org IDs and refs above still hold. Use the Management API with
  `$SUPABASE_ACCESS_TOKEN` and never print the token.

Rules:
- **PersonalKollen holds live data** and its RLS lets anon write. Only read from it here; never run DDL or DML against it from this repo.
- **wOrder** migrations: write `supabase/migrations/NNN_*.sql` first, then apply via MCP and verify with a select.
- The token lives in `~/.config/supabase/mcp-token` (chmod 600) and `~/.zshenv` exports it. Never write it into the repo.

## Git

`.claude/settings.json` has a hook that runs `git push origin main` after every `git commit`, so
every commit deploys straight to production on Vercel. Only commit when the user asks.
