import {readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const folder = new URL('../docs/qa/staging-owner-packet-20261007/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('source-manifest.json', folder)))
const baseline = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter(name => name.endsWith('.sql') && name < '20261006010000').map(name => name.split('_')[0]).sort()
if (baseline.length !== 324 || baseline.some(id => !/^\d{14}$/.test(id)) ||
    createHash('sha256').update(baseline.join('\n')).digest('hex') !== manifest.baselineVersionsSha256) throw Error('Baseline differs from packet')
const release = manifest.knownReleases.map(m => m.id)
const pending = manifest.migrations.map(m => m.id)
if (release.join(',') !== '20261003000000,20261003010000' || pending.join(',') !== '20261006010000,20261006020000') throw Error('Unexpected known/pending IDs')
const rows = baseline.map(id => `('${id}', 'baseline')`).concat(release.map(id => `('${id}', 'known_release')`),pending.map(id=>`('${id}', 'pending_feature')`))
writeFileSync(new URL('00-history-diagnostic.sql', folder), `-- READ ONLY. Verify Dashboard project jeugfyaqzfgdvfhdxfht / quest-platform-staging first.
-- Only migration version IDs are read; no statements, names, application rows or secrets.
-- This report never authorizes apply or history repair. Missing ledger/permission errors mean STOP.
begin read only;
set local statement_timeout='30s';
with expected(version, kind) as (values
${rows.join(',\n')}
), actual as (
  select version::text as version from supabase_migrations.schema_migrations
), missing_base as (
  select version from expected where kind='baseline' except select version from actual
), extra_base as (
  select version from actual except select version from expected where kind='baseline'
), missing_current as (
  select version from expected where kind<>'pending_feature' except select version from actual
), extra_current as (
  select version from actual except select version from expected where kind<>'pending_feature'
), missing_candidate as (
  select version from expected except select version from actual
), unexpected as (
  select version from actual except select version from expected
)
select jsonb_build_object(
  'database', current_database(),
  'transaction_read_only', current_setting('transaction_read_only'),
  'project_proof', 'OWNER MUST VERIFY DASHBOARD URL/HEADER; database name is not project proof',
  'expected_baseline_count', 324,
  'expected_current_count', 326,
  'expected_candidate_count', 328,
  'expected_current_sha256', '${manifest.currentVersionsSha256}',
  'expected_baseline_sha256', '${manifest.baselineVersionsSha256}',
  'actual_count', (select count(*) from actual),
  'actual_distinct_count', (select count(distinct version) from actual),
  'actual_null_count', (select count(*) from actual where version is null),
  'actual_versions', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from actual),
  'actual_versions_sha256_lf', (select encode(sha256(convert_to(coalesce(string_agg(version, chr(10) order by version collate "C"), ''), 'UTF8')), 'hex') from actual),
  'missing_vs_baseline', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from missing_base),
  'extra_vs_baseline', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from extra_base),
  'missing_vs_current', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from missing_current),
  'extra_vs_current', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from extra_current),
  'missing_vs_candidate', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from missing_candidate),
  'unexpected_vs_candidate', (select coalesce(jsonb_agg(version order by version collate "C"), '[]'::jsonb) from unexpected),
  'known_release_ids_present', (select coalesce(jsonb_agg(e.version order by e.version collate "C"), '[]'::jsonb) from expected e where kind='known_release' and exists(select 1 from actual a where a.version=e.version)),
  'pending_feature_ids_present', (select coalesce(jsonb_agg(e.version order by e.version collate "C"), '[]'::jsonb) from expected e where kind='pending_feature' and exists(select 1 from actual a where a.version=e.version))
) as migration_history_diagnostic;
rollback;
`)
console.log('Generated read-only diagnostic for known current 326 and post-apply 328.')
