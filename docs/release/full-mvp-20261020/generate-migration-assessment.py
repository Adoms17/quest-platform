"""Static SQL source inventory. Never connects to a database or executes SQL."""
import re
import json
import hashlib
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent

def statements(text):
    # Keep source offsets/lines; ignore semicolons inside strings, comments and dollar bodies.
    result, start, i, state, tag, depth = [], 0, 0, None, None, 0
    while i < len(text):
        if state == 'line':
            if text[i] == '\n': state = None
        elif state == 'block':
            if text[i:i+2] == '/*': depth += 1; i += 1
            elif text[i:i+2] == '*/':
                depth -= 1; i += 1
                if depth == 0: state = None
        elif state == 'dollar':
            if text.startswith(tag, i): i += len(tag)-1; state = None
        elif state in ("'", '"'):
            if text[i] == state:
                if text[i:i+2] == state*2: i += 1
                else: state = None
        elif text[i:i+2] == '--': state = 'line'; i += 1
        elif text[i:i+2] == '/*': state = 'block'; depth = 1; i += 1
        elif text[i] in "'\"": state = text[i]
        elif text[i] == '$' and (m := re.match(r'\$[A-Za-z_0-9]*\$', text[i:])):
            tag = m.group(); state = 'dollar'; i += len(tag)-1
        elif text[i] == ';':
            result.append((text.count('\n', 0, start)+1, text[start:i+1])); start = i+1
        i += 1
    if text[start:].strip(): result.append((text.count('\n', 0, start)+1, text[start:]))
    if state not in (None, 'line'): raise ValueError('Unterminated SQL lexical structure')
    return result

def uncomment(s):
    return re.sub(r'/\*.*?\*/|--[^\n]*', ' ', s, flags=re.S).strip()

def classify(text, path):
    evidence, tags, defined = [], set(), set()
    for line, raw in statements(text):
        s = uncomment(raw); low = s.lower()
        if not s: continue
        kind = 'other'
        if re.match(r'(begin|commit|set|comment)\b', low): kind = 'metadata'
        elif low.startswith('lock '): kind = 'lock'; tags.add('explicit-lock')
        elif re.match(r'(create (or replace )?function|alter function|drop function)\b', low):
            kind = 'routine'; tags.add('routine')
        elif re.match(r'(grant|revoke|create policy|drop policy|alter policy)\b', low) or re.search(r'^alter table.*?(enable|force|disable) row level security', low, re.S):
            kind = 'permissions'; tags.add('permissions')
        elif re.match(r'(create|alter|drop)\b', low): kind = 'schema'; tags.add('schema')
        elif re.match(r'(insert|update|delete|with|truncate)\b', low): kind = 'data'; tags.add('data')
        elif low.startswith('do ') and 'pg_get_functiondef' in low:
            kind = 'routine-patch'; tags.update(['routine','exact-function-body-patch'])
        elif low.startswith('do '): kind = 'precondition'; tags.add('precondition')
        elif low.startswith('select '): kind = 'top-level-call'; tags.add('top-level-call-review')
        if kind not in ('routine', 'metadata') and re.search(r'\bcron\.(schedule|alter_job|unschedule)\s*\(', low):
            tags.add('cron'); kind = 'cron'
        for m in re.finditer(r'\bcreate\s+(?:or\s+replace\s+)?(?:table|function|view|type|sequence)\s+(?:if\s+not\s+exists\s+)?((?:public|platform_private)\.[a-z_][a-z_0-9]*)', low): defined.add(m[1])
        for m in re.finditer(r'alter\s+function\s+((?:public|platform_private)\.[a-z_0-9]+)\s*\([^;]*?\)\s+rename\s+to\s+([a-z_0-9]+)', low):
            defined.add(m[1].split('.')[0]+'.'+m[2])
        for m in re.finditer(r'alter\s+function\s+((?:public|platform_private)\.[a-z_0-9]+)\s*\([^;]*?\)\s+set\s+schema\s+(public|platform_private)', low):
            defined.add(m[2]+'.'+m[1].split('.')[1])
        if kind == 'routine-patch':
            defined.update(re.findall(r"'((?:public|platform_private)\.[a-z_0-9]+)\([^']*\)'", low))
        # Only names and lexical statement kinds are published, never literal row values.
        evidence.append({'line': line, 'kind': kind, 'statement': re.sub(r'\s+', ' ', s).split('$$')[0][:150] if kind in ('schema','permissions') else re.sub(r'\s+', ' ', s).split('(')[0][:100] if kind == 'routine' else kind})
    if 'data' in tags:
        top = '\n'.join(uncomment(s) for _,s in statements(text) if re.match(r'(insert|update|delete|with|truncate)\b', uncomment(s), re.I))
        if re.search(r'\b(update|insert\s+into[\s\S]+?select)\b', top, re.I): tags.add('backfill')
        if re.search(r'\binsert\s+into[\s\S]+?\bvalues\b', top, re.I): tags.add('seed')
    if 'acceptance_fixture' in path: tags.add('fixture-support')
    refs = set(re.findall(r'\b(?:public|platform_private)\.[a-z_][a-z_0-9]*', uncomment(text).lower()))
    primary = next((x for x in ['fixture-support','cron','backfill','seed','data','schema','routine','permissions'] if x in tags), 'manual-review')
    return tags, primary, evidence, defined, refs

manifest = json.loads((OUT/'source-manifest.json').read_text(encoding='utf-8-sig'))
PHASES = [
 ('20260917160000','01','Подписки, квоты, offline, trial и sandbox billing'),
 ('20260918080000','02','Административный доступ и аудит'),
 ('20260919070000','03','Каталог и черновики тарифов'),
 ('20260921070000','04','Публикация тарифов, скидки и checkout'),
 ('20260922090000','05','Административные sandbox возвраты'),
 ('20260923060000','06','Согласия и recurring'),
 ('20260924020000','07','Stage reconciliation schedule'),
 ('20260925030000','08','Административные чтения и активность'),
 ('20260926000000','09','Возвраты подписки'),
 ('20260926038000','10','Документы покупки, чеки, settlement и цены'),
 ('20260928018000','11','Фискальная модель подписки и fixture'),
 ('20261001000000','12','Settlement schedule и исправления повторов'),
 ('99999999999999','13','Профили, account activity и received_at'),
]
rows, owners = [], {}
for m in manifest['migrations']:
    source = (ROOT/m['path']).read_text(encoding='utf-8').replace('\r\n','\n')
    assert hashlib.sha256(source.encode()).hexdigest() == m['sha256'], m['path']
    tags, primary, evidence, defined, refs = classify(source, m['path'])
    if not m['disposition'].startswith('production-ledger-version-present'):
        known = sorted({owners[r] for r in refs if r in owners and owners[r] != m['version']})
        unknown = sorted(refs - defined - set(owners))
        row = dict(version=m['version'], path=m['path'], sourceSha256=m['sha256'], primaryCategory=primary,
            categories=sorted(tags), statements=evidence, definesOrReplaces=sorted(defined),
            lexicalPriorProviders=known, unresolvedLexicalReferences=unknown,
            productionDisposition='HOLD', applicationOrder=None,
            sourceOrder=len(rows)+1, previousSourceVersion=manifest['migrations'][manifest['migrations'].index(m)-1]['version'],
            containsDmlIncludingRoutineBodies=bool(re.search(r'\b(insert into|update|delete from)\b', source, re.I)),
            exactBodyPatchTargets=sorted(set(re.findall(r"'((?:public|platform_private)\.[a-z_0-9]+\([^']*\))'", source, re.I))) if 'exact-function-body-patch' in tags else [],
            dynamicSql=('exact-function-body-patch' in tags or bool(re.search(r'\bexecute\s+(?!function\b|on\b|to\b)[a-z_$\x27]', source, re.I))),
            compatibilityRisks=['Проверить существующий каталог, сигнатуры и потребителей; ledger не подтверждает содержимое SQL.'],
            rollback='Сохранить совместимый предыдущий код; обратный SQL не определён и не разрешён.')
        phase = next(p for p in PHASES if m['version'] <= p[0])
        row['reviewPhase'] = phase[1]
        row['domain'] = phase[2]
        row['requiredDecisions'] = ['D1','D2','D8']
        if 'permissions' in tags: row['requiredDecisions'].append('D3')
        if tags & {'data','backfill','seed'}: row['requiredDecisions'].append('D4')
        if 'cron' in tags or m['version'] == '20260924020000': row['requiredDecisions'].append('D5')
        if 'fixture-support' in tags: row['requiredDecisions'].append('D6')
        if m['version'] >= '20260916024000': row['requiredDecisions'].append('D7')
        if 'permissions' in tags: row['compatibilityRisks'].append('Меняет grants/RLS или права функций: требуется отдельная сверка эффективных прав.')
        if tags & {'data','backfill','seed'}: row['compatibilityRisks'].append('Есть действия с данными при применении: нужны условия отбора, оценка существующих строк и восстановление; откат кода не отменяет данные.')
        if 'cron' in tags: row['compatibilityRisks'].append('Меняет расписание: до применения определить фактическое состояние и сохранить OFF; отмена SQL не отменяет отправленные запросы.')
        if 'routine' in tags: row['compatibilityRisks'].append('Определение функции не выполняет её тело; после публикации меняется поведение RPC/триггеров/worker.')
        if 'exact-function-body-patch' in tags: row['compatibilityRisks'].append('DO изменяет pg_get_functiondef через строковую замену; зависит от точного предыдущего тела, пропуск промежуточных миграций не доказан безопасным.')
        if 'fixture-support' in tags: row['compatibilityRisks'].append('Инструмент приёмочной fixture: отдельно решить допустимость в production; это не готовая бизнес-данная.')
        rows.append(row)
    for obj in defined: owners[obj] = m['version']

assert len(rows) == 228 and len({r['version'] for r in rows}) == 228
data = {'sourceHead':'6a654dc5738ff0c81bf31616c50a2a6c167c3b11', 'assessmentDate':'2026-10-20',
    'method':'Статический лексический разбор всех SQL; не SQL parser и не доказательство полного графа. Приоритетная категория взаимоисключающая, categories пересекаются. DML внутри CREATE FUNCTION не считается изменением данных при миграции.',
    'ledgerEvidence':'99 версий из сохранённого production history 2026-10-01; set подтверждён read-only list_migrations 2026-10-20 в предыдущем preflight; содержимое каталога не проверено.',
    'sourceManifestSha256':hashlib.sha256((OUT/'source-manifest.json').read_text(encoding='utf-8').replace('\r\n','\n').encode()).hexdigest(),
    'primaryCounts':dict(Counter(r['primaryCategory'] for r in rows)),
    'overlappingCategoryCounts':dict(Counter(t for r in rows for t in r['categories'])),
    'applyApproved':False, 'applyOrder':[], 'rows':rows}
(OUT/'migration-assessment.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
labels = {'schema':'schema','routine':'функции','seed':'seed','backfill':'backfill','cron':'cron','fixture-support':'fixture'}
table = ['# Реестр 228 миграций', '', 'Источник: `6a654dc5738ff0c81bf31616c50a2a6c167c3b11`. Все строки HOLD. Номер — исходный порядок, не разрешённый порядок применения. Полные хеши, операторы, зависимости и риски — в [JSON](migration-assessment.json); решения D1–D8 — в [оценке](MIGRATION-ASSESSMENT.md).', '', '| № | Версия / файл | Фаза | Основная категория | Решения |', '|---:|---|---|---|---|']
for r in rows:
    table.append(f"| {r['sourceOrder']} | [{Path(r['path']).stem}](../../../{r['path']}) | {r['reviewPhase']} | {labels[r['primaryCategory']]} | {', '.join(r['requiredDecisions'])} |")
(OUT/'MIGRATION-REGISTER.md').write_text('\n'.join(table)+'\n',encoding='utf-8')
print(json.dumps({k:data[k] for k in ['primaryCounts','overlappingCategoryCounts']},ensure_ascii=False))
for r in rows:
    print(r['version'], r['primaryCategory'], Path(r['path']).stem[15:], ' | '.join(e['statement'] for e in r['statements'] if e['kind'] in ('data','do-block','top-level-call','cron','other')))
