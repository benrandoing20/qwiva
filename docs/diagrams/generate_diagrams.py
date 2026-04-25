#!/usr/bin/env python3
"""Generate Qwiva architecture diagrams as Excalidraw JSON files."""
import json, os

DIR = os.path.dirname(os.path.abspath(__file__))

# ── element helpers ──────────────────────────────────────────────────────────

def _s(eid): return abs(hash(eid)) % 99989

def R(eid, x, y, w, h, bg="#ffffff", stroke="#1e1e2e", sw=2, rounded=True, dash=False):
    return {"id": eid, "type": "rectangle", "x": x, "y": y, "width": w, "height": h,
            "angle": 0, "strokeColor": stroke, "backgroundColor": bg,
            "fillStyle": "solid", "strokeWidth": sw,
            "strokeStyle": "dashed" if dash else "solid",
            "roughness": 0, "opacity": 100, "groupIds": [], "frameId": None,
            "roundness": {"type": 3} if rounded else None,
            "seed": _s(eid), "version": 1, "versionNonce": 1,
            "isDeleted": False, "boundElements": None, "updated": 1745535079000,
            "link": None, "locked": False}

def T(eid, x, y, w, h, text, color="#1e1e2e", size=12, align="center"):
    return {"id": eid, "type": "text", "x": x, "y": y, "width": w, "height": h,
            "angle": 0, "strokeColor": color, "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "groupIds": [], "frameId": None,
            "roundness": None, "seed": _s(eid + "t"), "version": 1, "versionNonce": 1,
            "isDeleted": False, "boundElements": None, "updated": 1745535079000,
            "link": None, "locked": False,
            "text": text, "fontSize": size, "fontFamily": 1,
            "textAlign": align, "verticalAlign": "middle",
            "containerId": None, "originalText": text, "lineHeight": 1.25}

def A(eid, pts, color="#475569", dash=False, label=None):
    x0, y0 = pts[0]
    rel = [[p[0] - x0, p[1] - y0] for p in pts]
    xs = [p[0] for p in rel]; ys = [p[1] for p in rel]
    out = [{"id": eid, "type": "arrow", "x": x0, "y": y0,
             "width": max(xs) - min(xs) or 1, "height": max(ys) - min(ys) or 1,
             "angle": 0, "strokeColor": color, "backgroundColor": "transparent",
             "fillStyle": "solid", "strokeWidth": 2,
             "strokeStyle": "dashed" if dash else "solid",
             "roughness": 0, "opacity": 100, "groupIds": [], "frameId": None,
             "roundness": {"type": 2}, "seed": _s(eid + "a"), "version": 1, "versionNonce": 1,
             "isDeleted": False, "boundElements": None, "updated": 1745535079000,
             "link": None, "locked": False,
             "points": rel, "lastCommittedPoint": None,
             "startBinding": None, "endBinding": None,
             "startArrowhead": None, "endArrowhead": "arrow"}]
    if label:
        mx = (pts[0][0] + pts[-1][0]) // 2 - 40
        my = (pts[0][1] + pts[-1][1]) // 2 - 12
        out.append(T(eid + "_lbl", mx, my, 100, 20, label, color, 10))
    return out

def box(eid, x, y, w, h, txt, bg, stroke, tcol, sz=11):
    return [R(eid, x, y, w, h, bg, stroke),
            T(eid + "_t", x + 4, y + 2, w - 8, h - 4, txt, tcol, sz)]

def lane_bg(eid, x, y, w, h, title, bg, stroke, hdr_fill):
    return [R(eid + "_bg", x, y, w, h, bg, stroke, 2, False),
            R(eid + "_hdr", x, y, w, 40, hdr_fill, hdr_fill, 0, False),
            T(eid + "_hdr_t", x + 10, y + 2, w - 20, 36, title, "#ffffff", 14)]

def wrap(elements):
    return {"type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
            "elements": elements,
            "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
            "files": {}}

def flatten(lst):
    out = []
    for item in lst:
        if isinstance(item, list):
            out.extend(flatten(item))
        else:
            out.append(item)
    return out


# ════════════════════════════════════════════════════════════════════════════
# DIAGRAM 1 — HIGH-LEVEL ARCHITECTURE
# ════════════════════════════════════════════════════════════════════════════

def high_level():
    els = []

    # ── Title ────────────────────────────────────────────────────────────
    els += [T("title", 20, 8, 1800, 28,
               "Qwiva — Clinical AI Platform   ·   High-Level Architecture",
               "#1e293b", 17)]

    # ── LANE 1: FRONTEND (x=20, w=440) ───────────────────────────────────
    FX, FW, FY, FH = 20, 440, 44, 800
    els += lane_bg("fe", FX, FY, FW, FH, "FRONTEND  (Next.js 14)",
                   "#faf5ff", "#a855f7", "#3b0764")

    fe_boxes = [
        ("fe_user",  "Physician User",
         "#ede9fe", "#8b5cf6", "#4c1d95"),
        ("fe_nb",    "Navbar.tsx\nfixed nav · sign-out",
         "#f3e8ff", "#a855f7", "#3b0764"),
        ("fe_sb",    "SearchBar.tsx  ·  ChatInput.tsx",
         "#f3e8ff", "#a855f7", "#3b0764"),
        ("fe_ac",    "AnswerCard.tsx  ·  StreamingText.tsx\ntypewriter · [1-3] citation compression",
         "#f3e8ff", "#a855f7", "#3b0764"),
        ("fe_cs",    "ConversationSidebar\nbranch switching · title auto-gen",
         "#f3e8ff", "#a855f7", "#3b0764"),
        ("fe_cm",    "Community\nPosts · Comments · Follows · Feed",
         "#f3e8ff", "#a855f7", "#3b0764"),
        ("fe_api",   "lib/api.ts → streamSearch()\nSSE async generator",
         "#ede9fe", "#8b5cf6", "#4c1d95"),
        ("fe_supa",  "lib/supabase.ts → getAccessToken()\nBearer JWT header",
         "#ede9fe", "#8b5cf6", "#4c1d95"),
    ]
    fy = FY + 48
    for eid, txt, bg, stroke, tcol in fe_boxes:
        lines = txt.count("\n") + 1
        h = 32 + (lines - 1) * 16
        els += box(eid, FX + 14, fy, FW - 28, h, txt, bg, stroke, tcol, 11)
        fy += h + 8

    # ── LANE 2: BACKEND (x=480, w=600) ───────────────────────────────────
    BX, BW = 480, 600
    els += lane_bg("be", BX, FY, BW, FH, "FASTAPI BACKEND  (backend/)",
                   "#fffbeb", "#f59e0b", "#78350f")

    be_top = [
        ("be_auth",  "auth.py — HS256 JWT verify\nSUPABASE_JWT_SECRET · verify_aud: False",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_rate",  "slowapi — 15 req/min per user_id or IP",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_cls",   "classify() — Groq llama-3.3-70b-versatile\nchat  vs  rag  (~100ms latency)",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_cach",  "Semantic Cache — LRU 512 entries\n24h TTL · cosine ≥ 0.92 (skip if history)",
         "#fef3c7", "#f59e0b", "#78350f"),
    ]
    by = FY + 48
    for eid, txt, bg, stroke, tcol in be_top:
        lines = txt.count("\n") + 1
        h = 32 + (lines - 1) * 16
        els += box(eid, BX + 14, by, BW - 28, h, txt, bg, stroke, tcol, 11)
        by += h + 8

    # RAG pipeline highlighted sub-box
    RAG_H = 195
    els += [R("be_rag_box", BX + 14, by, BW - 28, RAG_H, "#fde68a", "#d97706", 2)]
    els += [T("be_rag_hdr", BX + 14, by + 2, BW - 28, 22,
               "RAG Pipeline  (rag.py)", "#451a03", 13)]
    rag_steps = [
        "_embed()  →  OpenAI text-embedding-3-small  (1536-dim)",
        "_hybrid_search():  Qdrant HNSW top-40  +  Supabase FTS  (asyncio.gather)",
        "_drug_direct_lookup()  →  ilike on medicine_name (parallel)",
        "_rrf_merge(k=60)  →  dedup · drug chunk injection",
        "_rerank()  →  NVIDIA llama-3.2-nv-rerankqa-1b-v2  (top-40 → top-10)",
        "_build_citations()  +  _derive_evidence_grade()",
        "_generate_stream()  →  LiteLLM claude-sonnet-4-6  (prompt cached, stream=True)",
        "SSE:  status  →  citations  →  token × N  →  done",
    ]
    for i, step in enumerate(rag_steps):
        els += [T(f"be_rag_s{i}", BX + 22, by + 26 + i * 21, BW - 44, 18,
                   step, "#451a03", 10, "left")]
    by += RAG_H + 8

    be_bot = [
        ("be_conv",  "conversations.py — tree-structured history\nget_active_path() · append_*_message() RPCs",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_soc",   "social.py — posts, comments, follows\nget_personalized_feed() RPC  (follow×1.5 · specialty×1.2)",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_prof",  "profiles.py — onboarding · specialty · verification",
         "#fef3c7", "#f59e0b", "#78350f"),
        ("be_main",  "main.py — 30+ routes\n/search/stream  /me  /conversations  /feed  /posts  /profile  /discover",
         "#fef3c7", "#f59e0b", "#78350f"),
    ]
    for eid, txt, bg, stroke, tcol in be_bot:
        lines = txt.count("\n") + 1
        h = 32 + (lines - 1) * 16
        els += box(eid, BX + 14, by, BW - 28, h, txt, bg, stroke, tcol, 11)
        by += h + 8

    # ── LANE 3: STORAGE (x=1100, w=520) ──────────────────────────────────
    SX, SW = 1100, 520
    els += lane_bg("st", SX, FY, SW, FH, "STORAGE LAYER", "#f0fdf4", "#22c55e", "#14532d")

    # Qdrant
    els += [R("st_qd", SX + 14, FY + 48, SW - 28, 112, "#dcfce7", "#22c55e")]
    els += [T("st_qd_t", SX + 18, FY + 50, SW - 36, 108,
               "Qdrant\nqwiva_docs  —  HNSW cosine · INT8 scalar quantization\nPayload indexes:\n  doc_type · is_current_version · evidence_tier",
               "#14532d", 11)]

    # Supabase
    sp_y = FY + 172
    els += [R("st_sp", SX + 14, sp_y, SW - 28, 640, "#dcfce7", "#22c55e")]
    els += [T("st_sp_hdr", SX + 18, sp_y + 2, SW - 36, 22,
               "Supabase  (PostgreSQL + pgvector)", "#14532d", 13)]

    supa_secs = [
        ("st_au",  "Auth\nauth.users  →  JWT issued by Supabase Auth", 32, 50),
        ("st_ch",  "Chunk Tables\nclinical_practice_guideline_chunks  (CPG)\nguideline_chunks  (PubMed)\ndrug_label_chunks  ·  documents_v2  (legacy)", 92, 78),
        ("st_cv",  "Chat History\nconversations  ·  messages\nparent_id + selected_child_id  (tree)\nRLS: users own their conversations", 180, 78),
        ("st_ss",  "Social\nuser_profiles  ·  posts  ·  post_likes\ncomments  ·  comment_likes  ·  follows\nRLS + DB triggers  (auto-count updates)", 268, 78),
        ("st_rp",  "Key RPCs\nmatch_documents · search_cpg_fts · search_pubmed_fts\nget_active_path · get_personalized_feed · discover_users\nappend_user_message · append_assistant_message", 356, 78),
        ("st_ix",  "Indexes\nHNSW cosine (vector)  ·  GIN (FTS + JSONB + arrays)\nB-tree (doc_id, chunk_index, user_id, created_at)", 444, 62),
    ]
    for eid, txt, yoff, h in supa_secs:
        els += [R(eid, SX + 24, sp_y + yoff, SW - 48, h, "#f0fdf4", "#86efac", 1)]
        els += [T(eid + "_t", SX + 28, sp_y + yoff + 2, SW - 56, h - 4, txt, "#14532d", 10)]

    # ── EXTERNAL SERVICES STRIP (y=860) ───────────────────────────────────
    EY = 860
    els += [R("ext_bg", 20, EY, 1600, 96, "#fef2f2", "#ef4444", 2, False)]
    els += [R("ext_hh", 20, EY, 1600, 28, "#7f1d1d", "#7f1d1d", 0, False)]
    els += [T("ext_hh_t", 30, EY + 2, 400, 26, "EXTERNAL SERVICES", "#ffffff", 13, "left")]

    ext_svcs = [
        ("ex_oai", "OpenAI\ntext-embedding-3-small (1536-dim)\nquery embed + (ingestion)", 0, 220),
        ("ex_ant", "Anthropic / LiteLLM\nclaude-sonnet-4-6\nstream=True · prompt caching", 232, 230),
        ("ex_nv",  "NVIDIA Inference API\nllama-3.2-nv-rerankqa-1b-v2\nHTTP POST · retry 3×", 474, 230),
        ("ex_gr",  "Groq\nllama-3.3-70b-versatile\nclassify + query expansion", 716, 220),
        ("ex_sau", "Supabase Auth\nemail/password\nJWT issuance", 948, 180),
        ("ex_lf",  "LangFuse\n(optional)\nobservability tracing", 1140, 180),
        ("ex_qdc", "Qdrant Cloud\nvector database\nhosted service", 1332, 180),
    ]
    for eid, txt, xoff, w in ext_svcs:
        els += [R(eid, 20 + xoff, EY + 32, w - 4, 56, "#fef2f2", "#ef4444", 1)]
        els += [T(eid + "_t", 24 + xoff, EY + 33, w - 12, 54, txt, "#7f1d1d", 10)]

    # ── ARROWS ────────────────────────────────────────────────────────────

    # Frontend → Backend: HTTPS POST /search/stream
    arr_y = FY + 280
    els += A("a_fe_be", [(FX + FW, arr_y), (BX, arr_y)], "#d97706",
             label="HTTPS POST /search/stream")

    # Frontend ↔ Supabase direct (anon key)
    els += A("a_fe_su_dir", [(FX + FW // 2, FY + FH),
                              (FX + FW // 2, EY - 6),
                              (SX + SW // 2, EY - 6),
                              (SX + SW // 2, FY + FH)],
             "#a855f7", True, label="anon key\n(auth + social reads)")

    # Backend → Qdrant (vector search)
    els += A("a_be_qd", [(BX + BW, FY + 110), (SX, FY + 110)], "#22c55e", True,
             label="vector search")

    # Backend → Supabase (FTS + conv + social writes)
    els += A("a_be_su", [(BX + BW, FY + 460), (SX, FY + 460)], "#22c55e", True,
             label="FTS RPCs + writes")

    # Backend → external AI services (dashed red, going down)
    for eid, bx_off, ex_cx in [
        ("a_be_oai", 200, 130),
        ("a_be_ant", 330, 360),
        ("a_be_nv",  460, 600),
        ("a_be_gr",  140, 835),
    ]:
        els += A(eid, [(BX + bx_off, FY + FH), (20 + ex_cx, EY + 32)], "#ef4444", True)

    return flatten(els)


# ════════════════════════════════════════════════════════════════════════════
# DIAGRAM 2 — DETAILED QUERY PIPELINE
# ════════════════════════════════════════════════════════════════════════════

def detailed():
    els = []

    els += [T("dtitle", 20, 8, 3100, 28,
               "Qwiva — Query Pipeline   ·   Detailed Architecture  (backend/rag.py)",
               "#1e293b", 17)]

    COL_Y, COL_H = 44, 980

    # Column definitions: (id, title, x, w)
    cols = [
        ("c0", "REQUEST + AUTH",           20,   260),
        ("c1", "ROUTE",                   300,   260),
        ("c2", "EMBED",                   580,   220),
        ("c3", "HYBRID RETRIEVAL\n(asyncio.gather)",
                                          820,   700),
        ("c4", "RRF MERGE",              1540,   240),
        ("c5", "RERANK",                 1800,   260),
        ("c6", "GENERATE",               2080,   360),
        ("c7", "SSE STREAM + CACHE",     2460,   280),
    ]

    for cid, title, cx, cw in cols:
        els += [R(cid + "_bg", cx, COL_Y, cw, COL_H, "#f8fafc", "#cbd5e1", 1, False)]
        els += [R(cid + "_hdr", cx, COL_Y, cw, 40, "#1e293b", "#1e293b", 0, False)]
        els += [T(cid + "_hdr_t", cx + 4, COL_Y + 2, cw - 8, 36, title, "#ffffff", 11)]

    # ── Col 0: REQUEST + AUTH ─────────────────────────────────────────────
    c0x, c0w = 20, 260
    c0_items = [
        (96,  76,  "d_http",
         "HTTPS POST /search/stream\n{query, conversation_id,\nparent_message_id}",
         "#f8fafc", "#94a3b8", "#334155"),
        (184, 64,  "d_jwt",
         "verify_token()\nHS256 decode\nSUPABASE_JWT_SECRET\nverify_aud: False",
         "#fef3c7", "#f59e0b", "#78350f"),
        (260, 44,  "d_rate",
         "slowapi RateLimiter\n15 req/min per user_id or IP",
         "#fef3c7", "#f59e0b", "#78350f"),
        (316, 64,  "d_hist",
         "Load conversation history\nget_active_path() RPC\nrecursive CTE (follows\nselected_child_id)",
         "#dcfce7", "#22c55e", "#14532d"),
    ]
    for y, h, eid, txt, bg, stroke, tcol in c0_items:
        els += box(eid, c0x + 10, y, c0w - 20, h, txt, bg, stroke, tcol, 10)

    els += A("a_c0_01", [(c0x + c0w // 2, 172), (c0x + c0w // 2, 184)], "#475569")
    els += A("a_c0_12", [(c0x + c0w // 2, 248), (c0x + c0w // 2, 260)], "#475569")
    els += A("a_c0_23", [(c0x + c0w // 2, 304), (c0x + c0w // 2, 316)], "#475569")
    els += A("a_c0_out", [(c0x + c0w, 200), (300, 200)], "#475569",
             label="query + history")

    # ── Col 1: ROUTE ──────────────────────────────────────────────────────
    c1x, c1w = 300, 260
    els += box("d_exp", c1x + 10, 96, c1w - 20, 64,
               "_expand_query()\nif len < 7 words AND history\nGroq: rewrite to full question",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_cls", c1x + 10, 172, c1w - 20, 64,
               "classify()\nGroq llama-3.3-70b-versatile\n'chat'  vs  'rag'  (~100ms)",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += [R("d_dec_rag", c1x + 40, 248, c1w - 80, 40, "#e0f2fe", "#0ea5e9", 2)]
    els += [T("d_dec_rag_t", c1x + 40, 249, c1w - 80, 38, "rag route?", "#0c4a6e", 13)]
    els += box("d_chat", c1x + 10, 300, c1w - 20, 44,
               "stream_chat()\ndirect LLM · no retrieval",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_cach", c1x + 10, 356, c1w - 20, 64,
               "Semantic Cache\nLRU 512 entries · 24h TTL\ncosine ≥ 0.92\nskip if conversation history",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += [R("d_dec_cache", c1x + 40, 432, c1w - 80, 40, "#e0f2fe", "#0ea5e9", 2)]
    els += [T("d_dec_cache_t", c1x + 40, 433, c1w - 80, 38, "cache hit?", "#0c4a6e", 13)]
    els += box("d_chit", c1x + 10, 484, c1w - 20, 44,
               "stream cached answer\n(skip retrieval + rerank + generate)",
               "#f0fdf4", "#22c55e", "#14532d", 10)

    els += A("a_c1_01", [(c1x + c1w // 2, 160), (c1x + c1w // 2, 172)], "#475569")
    els += A("a_c1_12", [(c1x + c1w // 2, 236), (c1x + c1w // 2, 248)], "#475569")
    els += A("a_dec_chat", [(c1x + c1w // 2, 288), (c1x + c1w // 2, 300)], "#475569",
             label="chat")
    els += A("a_dec_rag", [(c1x + c1w, 268), (580 + 10, 268)], "#d97706",
             label="rag →")
    els += A("a_c1_34", [(c1x + c1w // 2, 420), (c1x + c1w // 2, 432)], "#475569")
    els += A("a_dec_miss", [(c1x + c1w, 452), (580 + 10, 452)], "#d97706",
             label="cache miss →")
    els += A("a_dec_hit", [(c1x + c1w // 2, 472), (c1x + c1w // 2, 484)], "#22c55e",
             label="hit")

    # ── Col 2: EMBED ──────────────────────────────────────────────────────
    c2x, c2w = 580, 220
    els += box("d_emb", c2x + 10, 250, c2w - 20, 72,
               "_embed()\nAsyncOpenAI.embeddings.create()\nmodel: text-embedding-3-small\nreturns: list[float] 1536-dim",
               "#fee2e2", "#ef4444", "#7f1d1d", 10)
    els += box("d_emb_out", c2x + 10, 334, c2w - 20, 32,
               "query_embedding: list[float]  (1536)",
               "#f8fafc", "#94a3b8", "#334155", 10)
    els += A("a_emb_12", [(c2x + c2w // 2, 322), (c2x + c2w // 2, 334)], "#475569")
    els += A("a_emb_out", [(c2x + c2w, 350), (820 + 10, 350)], "#d97706",
             label="embedding →")

    # ── Col 3: HYBRID RETRIEVAL ───────────────────────────────────────────
    c3x, c3w = 820, 700
    SW3 = 214  # sub-lane width

    # Sub-lane headers
    for i, (stxt, sx) in enumerate([
        ("Vector Search\n(Qdrant)", c3x + 10),
        ("Full-Text Search\n(Supabase)", c3x + 240),
        ("Drug Direct\nLookup", c3x + 480),
    ]):
        els += [R(f"d_sh{i}", sx, 96, SW3, 36, "#78350f", "#78350f", 0, False)]
        els += [T(f"d_sh{i}_t", sx + 2, 97, SW3 - 4, 34, stxt, "#ffffff", 10)]

    # Qdrant sub-lane
    els += box("d_qv", c3x + 10, 140, SW3, 80,
               "_qdrant_search()\nHNSW cosine · top-40\nfilter: is_current_version=True\nexclude doc_type=drug (default)",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_qd", c3x + 10, 230, SW3, 60,
               "_qdrant_search(doc_type='drug')\nHNSW cosine · top-40\ndrug-specific filter",
               "#fde68a", "#d97706", "#451a03", 10)

    # FTS sub-lane
    els += box("d_fpre", c3x + 240, 140, SW3, 52,
               "FTS preprocessing\nstrip question words\nexpand abbrev: TB→tuberculosis",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_fcpg", c3x + 240, 202, SW3, 44,
               "search_cpg_fts() RPC\nclinical_practice_guideline_chunks",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_fpub", c3x + 240, 256, SW3, 36,
               "search_pubmed_fts() RPC\nguideline_chunks  (PubMed)",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_fdg",  c3x + 240, 302, SW3, 36,
               "drug_label_chunks FTS\n.filter('fts','wfts', query)",
               "#fde68a", "#d97706", "#451a03", 10)

    # Drug direct sub-lane
    els += box("d_ddir", c3x + 480, 140, SW3, 90,
               "_drug_direct_lookup()\nilike on medicine_name\nwords ≥ 5 chars\nPhase 1: parallel name scans\nPhase 2: fetch priority sections",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_dsec", c3x + 480, 240, SW3, 80,
               "Section priority by query intent:\ndosage_and_administration\npharmacodynamics\nmechanism_of_action\nindications_and_usage\nadverse_reactions",
               "#fef3c7", "#f59e0b", "#78350f", 10)

    # asyncio.gather bar
    els += [R("d_gather", c3x + 10, 348, c3w - 20, 36, "#fde68a", "#d97706", 2, False)]
    els += [T("d_gather_t", c3x + 10, 349, c3w - 20, 34,
               "asyncio.gather()  —  all retrieval coroutines execute concurrently",
               "#451a03", 11)]
    els += A("a_gather_out", [(c3x + c3w, 366), (1540 + 10, 366)], "#d97706",
             label="results →")

    # ── Col 4: RRF MERGE ──────────────────────────────────────────────────
    c4x, c4w = 1540, 240
    els += box("d_rrf", c4x + 10, 200, c4w - 20, 80,
               "_rrf_merge(k=60)\ndedup by chunk.id\nReciprocal Rank Fusion:\n1/(k+rank+1)  per source",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_dinj", c4x + 10, 290, c4w - 20, 70,
               "Drug chunk injection\ndirect lookup hits bypass RRF\ninjected at top slots\nmax: drug_inject_k",
               "#fde68a", "#d97706", "#451a03", 10)
    els += box("d_top40", c4x + 10, 370, c4w - 20, 28,
               "top-40 merged candidates",
               "#f8fafc", "#94a3b8", "#334155", 10)
    els += A("a_rrf_out", [(c4x + c4w, 398), (1800 + 10, 398)], "#d97706",
             label="top-40 →")

    # ── Col 5: RERANK ─────────────────────────────────────────────────────
    c5x, c5w = 1800, 260
    els += box("d_rtrnc", c5x + 10, 200, c5w - 20, 52,
               "Truncate to 1800 chars\nat sentence boundary\nbefore sending to API",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_rapi", c5x + 10, 262, c5w - 20, 64,
               "_rerank()\nNVIDIA Inference API POST\nllama-3.2-nv-rerankqa-1b-v2\ntop_n = 10",
               "#fee2e2", "#ef4444", "#7f1d1d", 10)
    els += box("d_rret", c5x + 10, 336, c5w - 20, 64,
               "Retry logic: 3× with backoff\n400 → halve doc length + retry\n429 / 5xx → exponential wait\nFallback: return unranked top-10",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_rout", c5x + 10, 410, c5w - 20, 28,
               "top-10 final chunks",
               "#f8fafc", "#94a3b8", "#334155", 10)
    els += A("a_rr_out", [(c5x + c5w, 424), (2080 + 10, 424)], "#d97706",
             label="top-10 →")

    # ── Col 6: GENERATE ───────────────────────────────────────────────────
    c6x, c6w = 2080, 360
    els += box("d_cite",  c6x + 10, 160, c6w - 20, 60,
               "_build_citations()\ndedup by guideline_title (case-insensitive)\nassign [1][2]… matching LLM output",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_evgr",  c6x + 10, 230, c6w - 20, 52,
               "_derive_evidence_grade()\ngrade_strength + grade_direction\n> evidence_tier  >  publisher",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_pmpt",  c6x + 10, 292, c6w - 20, 88,
               "Build messages[]\n• System prompt: 116 lines (Kenya clinical context)\n  cache_control: ephemeral  (Anthropic prompt caching)\n• History trimmed to 32,000 chars\n• User: _USER_TEMPLATE {question} + {numbered sources}",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_gen",   c6x + 10, 390, c6w - 20, 64,
               "litellm.acompletion()\nanthropic/claude-sonnet-4-6\nstream=True  ·  LangFuse trace (optional)\nmetadata: trace_name, num_sources, user_id",
               "#fee2e2", "#ef4444", "#7f1d1d", 10)
    els += A("a_gen_out", [(c6x + c6w, 430), (2460 + 10, 430)], "#d97706",
             label="token stream →")

    # ── Col 7: SSE STREAM + CACHE ─────────────────────────────────────────
    c7x, c7w = 2460, 280
    els += box("d_sse", c7x + 10, 160, c7w - 20, 150,
               "Server-Sent Events\n\nevent: status  {\"message\": \"Searching…\"}\nevent: status  {\"message\": \"Ranking…\"}\nevent: citations  {citations[], grade}\nevent: status  {\"message\": \"Generating…\"}\nevent: token  {\"token\": \"…\"}  × N\nevent: done  {}",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_cst", c7x + 10, 320, c7w - 20, 64,
               "Semantic Cache store  (on done)\nembedding + chunks + citations\n+ evidence_grade + full answer text\nLRU 512 entries · 24h TTL",
               "#fef3c7", "#f59e0b", "#78350f", 10)
    els += box("d_febe", c7x + 10, 394, c7w - 20, 52,
               "Frontend\nStreamingText.tsx\ntypewriter effect\n[1][2][3] → [1-3] compression",
               "#f3e8ff", "#a855f7", "#3b0764", 10)

    # ── STORAGE ROW ───────────────────────────────────────────────────────
    STY = 1040
    els += [R("st_row", 20, STY, 2720, 130, "#f0fdf4", "#22c55e", 2, False)]
    els += [R("st_row_hdr", 20, STY, 2720, 28, "#14532d", "#14532d", 0, False)]
    els += [T("st_row_hdr_t", 30, STY + 2, 600, 26,
               "STORAGE  —  dashed = reads   solid = writes", "#ffffff", 12, "left")]

    st_boxes = [
        ("stb_qd",  "Qdrant\nqwiva_docs\nHNSW cosine · INT8 quant",      0,   200),
        ("stb_cpg", "Supabase\nclinical_practice_\nguideline_chunks",   212,   190),
        ("stb_gh",  "Supabase\nguideline_chunks\n(PubMed articles)",    414,   190),
        ("stb_dch", "Supabase\ndrug_label_chunks",                      616,   190),
        ("stb_d2",  "Supabase\ndocuments_v2 (legacy)",                  818,   190),
        ("stb_cv",  "Supabase\nconversations\n+ messages  (tree)",     1020,   200),
        ("stb_up",  "Supabase\nuser_profiles",                         1232,   180),
        ("stb_ps",  "Supabase\nposts · post_likes\ncomments · comment_likes", 1424, 200),
        ("stb_fw",  "Supabase\nfollows",                               1636,   180),
    ]
    for eid, txt, xoff, w in st_boxes:
        els += [R(eid, 20 + xoff, STY + 32, w - 4, 88, "#dcfce7", "#22c55e", 1)]
        els += [T(eid + "_t", 24 + xoff, STY + 33, w - 12, 86, txt, "#14532d", 10)]

    # Storage read arrows (dashed, upward to pipeline)
    els += A("sa_qd",  [(20 + 100,  STY + 32), (c3x + 55,  350)], "#22c55e", True, "vector")
    els += A("sa_cpg", [(20 + 307,  STY + 32), (c3x + 335, 350)], "#22c55e", True, "FTS RPC")
    els += A("sa_dch", [(20 + 711,  STY + 32), (c3x + 555, 350)], "#22c55e", True, "FTS+ilike")
    els += A("sa_cv",  [(20 + 1120, STY + 32), (c0x + 130, 380)], "#22c55e", True, "history")

    # Write arrow: pipeline → conversations
    els += A("aw_cv", [(c7x + c7w // 2, c7x - 2000),
                       (c7x + c7w // 2, STY)],
             "#22c55e", False, "persist")

    # ── SOCIAL SECTION ────────────────────────────────────────────────────
    SOC_Y = 1192
    els += [R("soc_bg", 20, SOC_Y, 2720, 290, "#fce7f3", "#ec4899", 2, False)]
    els += [R("soc_hdr", 20, SOC_Y, 2720, 30, "#831843", "#831843", 0, False)]
    els += [T("soc_hdr_t", 30, SOC_Y + 2, 800, 28,
               "SOCIAL LAYER  (backend/social.py + profiles.py  +  Supabase triggers)",
               "#ffffff", 13, "left")]

    soc_items = [
        ("sc_pst",   "POST /posts\nposts table\ntriggers: post_count++, touch_post()",
         0, 200),
        ("sc_lk",    "POST /posts/{id}/like\npost_likes table\ntrigger: like_count ± 1",
         212, 200),
        ("sc_feed",  "GET /feed\nget_personalized_feed() RPC\nfollow_boost × 1.5\nspecialty_match × 1.2\nrecency decay + engagement score\ncursor pagination",
         424, 200),
        ("sc_disc",  "GET /discover/users\ndiscover_users() RPC\nfilter: specialty / country\norder: followers DESC",
         636, 200),
        ("sc_fol",   "POST/DELETE /users/{id}/follow\nfollows table\ntrigger: follower /\nfollowing counts",
         848, 190),
        ("sc_cmt",   "POST /posts/{id}/comments\ncomments table  (threaded)\nparent_comment_id\ncomment_likes + trigger",
         1050, 210),
        ("sc_prf",   "GET / PUT /profile/me\nuser_profiles table\nonboarding_complete flag\nspecialty · country · bio · avatar",
         1272, 210),
        ("sc_msg",   "Chat messages persisted\nappend_user_message() RPC\nappend_assistant_message() RPC\ncitations + evidence_grade (JSONB)\nget_siblings() for branch UI",
         1494, 220),
    ]
    for eid, txt, xoff, w in soc_items:
        lines = txt.count("\n") + 1
        h = min(36 + (lines - 1) * 16, 230)
        els += [R(eid, 20 + xoff, SOC_Y + 38, w - 4, h, "#fdf2f8", "#ec4899", 1)]
        els += [T(eid + "_t", 24 + xoff, SOC_Y + 39, w - 12, h - 2, txt, "#831843", 10)]

    return flatten(els)


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(DIR, exist_ok=True)

    hl_path = os.path.join(DIR, "qwiva_high_level.excalidraw")
    with open(hl_path, "w", encoding="utf-8") as f:
        json.dump(wrap(high_level()), f, indent=2, ensure_ascii=False)
    print(f"Wrote {hl_path}")

    det_path = os.path.join(DIR, "qwiva_detailed.excalidraw")
    with open(det_path, "w", encoding="utf-8") as f:
        json.dump(wrap(detailed()), f, indent=2, ensure_ascii=False)
    print(f"Wrote {det_path}")


if __name__ == "__main__":
    main()
