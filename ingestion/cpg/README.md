# Qwiva CPG Pipeline

Automated ingestion pipeline for clinical practice guidelines into Supabase.

Stages: **Discover → Fetch & Store → Parse & Chunk → Embed**

Sources currently supported: `nice`, `moh_kenya`

---

## Architecture

```
01_discover.py     Crawls source websites for guideline URLs → corpus_documents
02_fetch_store.py  Downloads content → Supabase Storage (corpus-raw bucket)
03_parse_chunk.py  Parses HTML/PDF → chunks → contextual_text via Claude Haiku
04_embed_insert.py Embeds chunks via text-embedding-3-large → clinical_practice_guideline_chunks
```

Each stage is independently resumable. Documents are tracked via `pipeline_status` in `corpus_documents`:
`discovered → fetched → stored → parsed → chunked → embedded → complete`

---

## Local Setup

```bash
git clone https://github.com/your-org/qwiva-cpg-pipeline
cd qwiva-cpg-pipeline

pip install -r requirements.txt

cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
```

### Run a single source end-to-end

```bash
python run_pipeline.py --source nice
python run_pipeline.py --source moh_kenya
python run_pipeline.py --source all
```

### Run specific stages only

```bash
python run_pipeline.py --source nice --stages 1,2     # discover + fetch only
python run_pipeline.py --source nice --stages 3,4     # parse + embed only
```

### Retry failed documents

```bash
python run_pipeline.py --source nice --retry-failed
```

### Run individual stages directly

```bash
python 01_discover.py --source nice --log-level DEBUG
python 02_fetch_store.py --source nice --log-level INFO
python 03_parse_chunk.py --source nice --log-level INFO
python 04_embed_insert.py --source nice --log-level INFO
```

---

## Railway Deployment

### First deploy

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Create project: `railway init`
4. Set environment variables (see below)
5. Deploy: `railway up`

### Environment variables

Set these in Railway dashboard → Service → Variables (NOT in code):

| Variable              | Description                        |
|-----------------------|------------------------------------|
| `SUPABASE_URL`        | Your Supabase project URL          |
| `SUPABASE_SERVICE_KEY`| Service role key (not anon key)    |
| `OPENAI_API_KEY`      | For text-embedding-3-large         |
| `ANTHROPIC_API_KEY`   | For Claude Haiku context headers   |

Set these on **both** `nice-pipeline` and `moh-pipeline` services.

### Cron schedules

| Service         | Schedule              | Description                  |
|-----------------|-----------------------|------------------------------|
| `nice-pipeline` | `0 2 1 * *`           | 2am UTC, 1st of every month  |
| `moh-pipeline`  | `0 3 1 1,4,7,10 *`    | 3am UTC, quarterly           |

### Trigger manually (first full run)

```bash
# Trigger the full NICE batch immediately via Railway CLI
railway run --service nice-pipeline python run_pipeline.py --source nice

# Or via Railway dashboard: Service → Deploy → Run
```

### View logs

```bash
railway logs --service nice-pipeline
railway logs --service moh-pipeline
```

---

## Adding a New Source

1. Add a `SourceConfig` entry to `config.py`:

```python
SOURCES["who"] = SourceConfig(
    source_id               = "who",
    issuing_body_canonical  = "WHO",
    authority_rank          = 1,
    geographic_scope        = "global",
    fetch_strategy          = "crawl_pdf",
    base_url                = "https://www.who.int/publications/guidelines",
    licence                 = "CC BY-NC-SA 3.0 IGO",
    recrawl_days            = 90,
    domain_map              = {},
)
```

2. Add a discovery function to `01_discover.py`
3. Add a fetch function to `02_fetch_store.py` (if different from PDF/HTML)
4. Register both in their respective `DISCOVERY_FUNCTIONS` / `FETCH_FUNCTIONS` dicts
5. Add a new service block to `railway.toml`

The parse and embed stages require no changes — they're source-agnostic.

---

## Supabase Setup

Required tables (run migrations in order):
- `corpus_documents` — one row per guideline document
- `clinical_practice_guideline_chunks` — one row per chunk with embedding

Required Storage bucket:
- `corpus-raw` (private) — stores raw JSON bundles and PDFs

---

## Monitoring

Check pipeline health in Supabase:

```sql
-- Status by source
SELECT source_id, pipeline_status, COUNT(*)
FROM corpus_documents
GROUP BY source_id, pipeline_status
ORDER BY source_id, pipeline_status;

-- Failed documents
SELECT guideline_title, failed_stage, last_error, retry_count
FROM corpus_documents
WHERE pipeline_status = 'failed'
ORDER BY updated_at DESC;

-- Chunk coverage
SELECT 
    cd.source_id,
    COUNT(DISTINCT cd.id) as documents,
    COUNT(cpg.id) as total_chunks,
    COUNT(cpg.embedding) as embedded_chunks
FROM corpus_documents cd
LEFT JOIN clinical_practice_guideline_chunks cpg ON cpg.doc_id = cd.id
WHERE cd.pipeline_status = 'complete'
GROUP BY cd.source_id;
```
