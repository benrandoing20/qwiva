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

    # ── ROW A: Vector Store + Chunk Tables ───────────────────────────────
    RA_Y = 1048
    RA_H = 820
    els += [R("ra_bg",  20, RA_Y, 2720, RA_H, "#f0fdf4", "#22c55e", 2, False)]
    els += [R("ra_hdr", 20, RA_Y, 2720, 32,   "#14532d", "#14532d", 0, False)]
    els += [T("ra_hdr_t", 30, RA_Y + 2, 1400, 28,
               "ROW A — VECTOR STORE + CHUNK TABLES  (pgvector · Qdrant · Supabase)",
               "#ffffff", 13, "left")]
    PA_Y = RA_Y + 36
    PA_H = RA_H - 44

    # A1 — Qdrant
    els += box("a1_qd", 24, PA_Y, 450, PA_H,
        "Qdrant  —  qwiva_docs\n"
        "Vector: size=1536, distance=Cosine\n"
        "Quantization: INT8 scalar\n"
        "  quantile=0.99, always_ram=True\n"
        "\n"
        "Payload fields:\n"
        "  id, content, doc_type\n"
        "  guideline_title, cascading_path\n"
        "  publisher, pub_year\n"
        "  evidence_tier, grade_strength\n"
        "  grade_direction\n"
        "  is_current_version BOOL\n"
        "  superseded_by\n"
        "  geography, source_url\n"
        "  doc_id, chunk_index\n"
        "  inn, section_type\n"
        "\n"
        "Payload indexes:\n"
        "  doc_type = keyword\n"
        "  is_current_version = bool\n"
        "  evidence_tier = integer",
        "#dcfce7", "#22c55e", "#14532d", 10)

    # A2 — clinical_practice_guideline_chunks
    els += box("a2_cpg", 478, PA_Y, 510, PA_H,
        "clinical_practice_guideline_chunks\n"
        "  id UUID  (UUID5: guideline_id:ver:i)\n"
        "  content TEXT\n"
        "  embedding vector(1536)\n"
        "  fts tsvector  (GIN)\n"
        "  content_hash TEXT  (SHA-256)\n"
        "  guideline_id TEXT\n"
        "  guideline_version TEXT\n"
        "  is_current_version BOOL\n"
        "  superseded_by TEXT\n"
        "  guideline_title TEXT\n"
        "  issuing_body TEXT\n"
        "  pub_year INT\n"
        "  evidence_tier INT\n"
        "  document_type TEXT\n"
        "  geographic_scope TEXT\n"
        "  source_url TEXT, licence TEXT\n"
        "  cascading_path TEXT[]\n"
        "  chunk_index INT, total_chunks INT\n"
        "  word_count INT\n"
        "  chunk_type TEXT DEFAULT 'text'\n"
        "  created_at TIMESTAMPTZ\n"
        "\n"
        "Indexes:\n"
        "  HNSW cosine (embedding)\n"
        "  GIN (fts)\n"
        "  B-tree is_current_version\n"
        "  B-tree (guideline_id, version)",
        "#f0fdf4", "#86efac", "#14532d", 10)

    # A3 — guideline_chunks (top) + drug_label_chunks (bottom)
    GC_H = (PA_H - 8) // 2
    els += box("a3_gc", 992, PA_Y, 380, GC_H,
        "guideline_chunks  (PubMed)\n"
        "  Same schema as CPG table\n"
        "  doc_type = 'pubmed'\n"
        "  evidence_tier = 2\n"
        "  Used by search_pubmed_fts() RPC\n"
        "  HNSW cosine + GIN fts indexes",
        "#f0fdf4", "#86efac", "#14532d", 10)
    els += box("a4_dc", 992, PA_Y + GC_H + 8, 380, PA_H - GC_H - 8,
        "drug_label_chunks\n"
        "  id UUID PK\n"
        "  inn TEXT  (INN drug name)\n"
        "  medicine_name TEXT\n"
        "  section_type TEXT:\n"
        "   dosage_and_administration\n"
        "   pharmacodynamics\n"
        "   mechanism_of_action\n"
        "   indications_and_usage\n"
        "   adverse_reactions\n"
        "   pharmacokinetics\n"
        "   contraindications\n"
        "   warnings_and_precautions\n"
        "  content TEXT\n"
        "  source_type [fda|emc]\n"
        "  brand_name TEXT\n"
        "  content_hash TEXT\n"
        "  created_at TIMESTAMPTZ\n"
        "Indexes: B-tree inn, GIN fts",
        "#f0fdf4", "#86efac", "#14532d", 10)

    # A4 — documents_v2 (legacy)
    els += box("a5_d2", 1376, PA_Y, 520, PA_H,
        "documents_v2  (LEGACY)\n"
        "  id BIGSERIAL PK\n"
        "  content TEXT\n"
        "  embedding vector(1536)\n"
        "  metadata JSONB\n"
        "  fts tsvector\n"
        "  record_manager_id FK\n"
        "\n"
        "Generated columns (migration 001, STORED):\n"
        "  guideline_title  (metadata->>'guideline_title')\n"
        "  publisher        (metadata->>'publisher')\n"
        "  geography        (metadata->>'geography')\n"
        "  doc_id_col       (metadata->>'doc_id')\n"
        "  chunk_index_col::INT\n"
        "  year_pub::INT    (metadata->>'year')\n"
        "\n"
        "Indexes:\n"
        "  HNSW cosine (embedding)\n"
        "  GIN fts, GIN metadata\n"
        "  B-tree doc_id, chunk_index\n"
        "  B-tree generated cols\n"
        "\n"
        "RPCs:\n"
        "  match_documents(query_embedding,\n"
        "    match_count)\n"
        "  get_chunks_by_ranges(doc_id, ranges)\n"
        "  dynamic_hybrid_search_db(\n"
        "    query_text, query_embedding,\n"
        "    match_count, ...filters)",
        "#fefce8", "#ca8a04", "#713f12", 10)

    # A5 — Extensions + Legacy Tables
    els += box("a6_ext", 1900, PA_Y, 836, PA_H,
        "Extensions + Legacy Tables\n"
        "\n"
        "Extensions:\n"
        "  pgvector  — vector similarity + HNSW indexes\n"
        "  pg_trgm   — trigram similarity (GIN indexes)\n"
        "\n"
        "record_manager_v2:\n"
        "  id BIGSERIAL, doc_id TEXT, hash TEXT\n"
        "  data_type TEXT, schema TEXT\n"
        "  document_title TEXT, document_headline TEXT\n"
        "  document_summary TEXT, status TEXT\n"
        "\n"
        "metadata_fields  (schema registry):\n"
        "  id, metadata_name TEXT\n"
        "  allowed_values TEXT[]\n"
        "\n"
        "tabular_document_rows:\n"
        "  id, record_manager_id FK\n"
        "  row_data JSONB  (structured table rows\n"
        "  extracted from guideline tables)\n"
        "\n"
        "n8n_chat_histories  (LEGACY):\n"
        "  flat chat format\n"
        "  superseded by conversations + messages",
        "#fef9c3", "#ca8a04", "#713f12", 10)

    # Arrows: pipeline → ROW A
    els += A("da_qd",  [(c3x + 110, COL_Y + COL_H), (24 + 200,  RA_Y)], "#22c55e", True, "vector")
    els += A("da_cpg", [(c3x + 340, COL_Y + COL_H), (478 + 200, RA_Y)], "#22c55e", True, "CPG FTS")
    els += A("da_dc",  [(c3x + 560, COL_Y + COL_H), (992 + 140, RA_Y + GC_H + 8)], "#22c55e", True, "drug FTS")
    els += A("da_d2",  [(c3x + 660, COL_Y + COL_H), (1376 + 100, RA_Y)], "#22c55e", True, "legacy RPC")

    # ── ROW B: App Tables ─────────────────────────────────────────────────
    RB_Y = RA_Y + RA_H + 16
    RB_H = 820
    els += [R("rb_bg",  20, RB_Y, 2720, RB_H, "#eff6ff", "#3b82f6", 2, False)]
    els += [R("rb_hdr", 20, RB_Y, 2720, 32,   "#1e3a8a", "#1e3a8a", 0, False)]
    els += [T("rb_hdr_t", 30, RB_Y + 2, 1400, 28,
               "ROW B — APP TABLES  (Auth · Chat History · Profiles · Follows)",
               "#ffffff", 13, "left")]
    PB_Y = RB_Y + 36
    PB_H = RB_H - 44

    # B1 — conversations
    els += box("b1_conv", 24, PB_Y, 420, PB_H,
        "conversations\n"
        "  id UUID PK DEFAULT gen_random_uuid()\n"
        "  user_id UUID FK auth.users CASCADE\n"
        "  title TEXT NULL\n"
        "  title_generated BOOL DEFAULT FALSE\n"
        "  created_at TIMESTAMPTZ\n"
        "  updated_at TIMESTAMPTZ\n"
        "\n"
        "Index:\n"
        "  B-tree (user_id, updated_at DESC)\n"
        "\n"
        "RLS:\n"
        "  SELECT/INSERT/UPDATE/DELETE\n"
        "  WHERE auth.uid() = user_id\n"
        "\n"
        "Trigger: touch_conversation()\n"
        "  AFTER INSERT on messages\n"
        "  UPDATE conversations\n"
        "  SET updated_at = NOW()\n"
        "  WHERE id = NEW.conversation_id",
        "#dbeafe", "#3b82f6", "#1e3a8a", 10)

    # B2 — messages
    els += box("b2_msg", 448, PB_Y, 600, PB_H,
        "messages\n"
        "  id UUID PK DEFAULT gen_random_uuid()\n"
        "  conversation_id UUID FK CASCADE\n"
        "  parent_id UUID FK self NULL  (NULL=root)\n"
        "  selected_child_id UUID FK self NULL\n"
        "    (NULL=leaf, tracks active branch)\n"
        "  role TEXT  [user|assistant]\n"
        "  content TEXT\n"
        "  citations JSONB  (assistant only)\n"
        "  evidence_grade TEXT  (assistant only)\n"
        "  branch_index INT DEFAULT 0\n"
        "    (0=original, 1,2...=edits at fork)\n"
        "  created_at TIMESTAMPTZ\n"
        "\n"
        "Indexes:\n"
        "  B-tree (conversation_id, created_at)\n"
        "  B-tree parent_id\n"
        "  B-tree (parent_id, branch_index)\n"
        "\n"
        "RLS: via conversation JOIN\n"
        "Trigger: touch_conversation (above)\n"
        "\n"
        "Chat RPCs:\n"
        "  get_active_path(conversation_id)\n"
        "    recursive CTE: root -> leaf\n"
        "    follows selected_child_id\n"
        "  get_siblings(parent_id)\n"
        "    all branches at a fork\n"
        "  append_user_message(conv_id,\n"
        "    parent_id, content)\n"
        "    INSERT + UPDATE selected_child_id\n"
        "  append_assistant_message(conv_id,\n"
        "    parent_id, content, citations,\n"
        "    evidence_grade)",
        "#dbeafe", "#3b82f6", "#1e3a8a", 10)

    # B3 — auth.users + user_profiles
    els += box("b3_prof", 1052, PB_Y, 570, PB_H,
        "auth.users  (Supabase managed)\n"
        "  id UUID PK, email TEXT\n"
        "  encrypted_password TEXT\n"
        "  created_at, last_sign_in_at\n"
        "\n"
        "user_profiles\n"
        "  user_id UUID PK FK auth.users CASCADE\n"
        "  display_name TEXT NOT NULL\n"
        "  specialty TEXT, subspecialty TEXT\n"
        "  institution TEXT\n"
        "  country TEXT DEFAULT 'Kenya'\n"
        "  city TEXT, bio TEXT, avatar_url TEXT\n"
        "  years_experience INT\n"
        "  medical_license TEXT\n"
        "  verification_status TEXT DEFAULT 'unverified'\n"
        "    [unverified|pending|verified]\n"
        "  languages TEXT[], interests TEXT[]\n"
        "  onboarding_complete BOOL DEFAULT FALSE\n"
        "  follower_count INT DEFAULT 0\n"
        "  following_count INT DEFAULT 0\n"
        "  post_count INT DEFAULT 0\n"
        "  created_at, updated_at\n"
        "\n"
        "Indexes: specialty, country, follower_count DESC\n"
        "RLS: SELECT all, write own\n"
        "\n"
        "Triggers:\n"
        "  handle_new_user()  AFTER INSERT auth.users\n"
        "    -> auto-create skeleton profile\n"
        "    display_name from email, country='Kenya'\n"
        "  touch_profile()  AFTER UPDATE\n"
        "    -> SET updated_at = NOW()",
        "#dbeafe", "#3b82f6", "#1e3a8a", 10)

    # B4 — follows + social RPCs
    els += box("b4_fol", 1626, PB_Y, 1110, PB_H,
        "follows\n"
        "  follower_id UUID FK user_profiles\n"
        "  following_id UUID FK user_profiles\n"
        "  PK: (follower_id, following_id)\n"
        "  CHECK: follower_id <> following_id\n"
        "  Indexes: B-tree follower_id, B-tree following_id\n"
        "  RLS: SELECT all, INSERT/DELETE own\n"
        "\n"
        "Trigger: update_follow_counts()\n"
        "  AFTER INSERT -> follower_count++ on following_id\n"
        "                  following_count++ on follower_id\n"
        "  AFTER DELETE -> decrement both\n"
        "\n"
        "Social RPCs:\n"
        "  get_personalized_feed(user_id, cursor, limit=20, filter)\n"
        "    Score = follow_boost(1.5) x specialty_match(1.2)\n"
        "          x recency_decay\n"
        "          + 0.1 x log(1+likes)\n"
        "          + 0.05 x log(1+comments)\n"
        "    Cursor pagination on created_at\n"
        "\n"
        "  discover_users(user_id, specialty, country,\n"
        "    limit=20, offset=0)\n"
        "    Filter: onboarding_complete=TRUE\n"
        "    Order: follower_count DESC\n"
        "\n"
        "  get_post_with_context(post_id, user_id)\n"
        "\n"
        "  get_comments_with_context(post_id, user_id,\n"
        "    limit=50) — threaded by parent_comment_id",
        "#dbeafe", "#3b82f6", "#1e3a8a", 10)

    # Arrows: pipeline -> ROW B
    els += A("db_cv",  [(c0x + 130, COL_Y + COL_H), (24 + 200,  RB_Y)], "#22c55e", True, "history")
    els += A("db_msg", [(c7x + 140, COL_Y + COL_H), (448 + 280, RB_Y)], "#22c55e", False, "persist")

    # ── ROW C: Social Tables ──────────────────────────────────────────────
    RC_Y = RB_Y + RB_H + 16
    RC_H = 700
    els += [R("rc_bg",  20, RC_Y, 2720, RC_H, "#fdf2f8", "#ec4899", 2, False)]
    els += [R("rc_hdr", 20, RC_Y, 2720, 32,   "#831843", "#831843", 0, False)]
    els += [T("rc_hdr_t", 30, RC_Y + 2, 1400, 28,
               "ROW C — SOCIAL TABLES  (posts · post_likes · comments · comment_likes)",
               "#ffffff", 13, "left")]
    PC_Y = RC_Y + 36
    PC_H = RC_H - 44

    # C1 — posts
    els += box("c1_pst", 24, PC_Y, 580, PC_H,
        "posts\n"
        "  id UUID PK DEFAULT gen_random_uuid()\n"
        "  author_id UUID FK user_profiles CASCADE\n"
        "  content TEXT CHECK(length 1-5000)\n"
        "  post_type TEXT DEFAULT 'question'\n"
        "    [question|case_discussion|\n"
        "     clinical_pearl|resource]\n"
        "  tags TEXT[]\n"
        "  specialty_tags TEXT[]\n"
        "  image_urls TEXT[]\n"
        "  is_anonymous BOOL DEFAULT FALSE\n"
        "  like_count INT DEFAULT 0\n"
        "  comment_count INT DEFAULT 0\n"
        "  view_count INT DEFAULT 0\n"
        "  created_at TIMESTAMPTZ\n"
        "  updated_at TIMESTAMPTZ\n"
        "  is_deleted BOOL DEFAULT FALSE\n"
        "\n"
        "Indexes:\n"
        "  B-tree (author_id, created_at DESC)\n"
        "  B-tree created_at DESC WHERE NOT is_deleted\n"
        "  GIN specialty_tags, GIN tags\n"
        "  B-tree (like_count DESC, comment_count DESC)\n"
        "    WHERE NOT is_deleted\n"
        "  GIN to_tsvector('english', content)\n"
        "\n"
        "RLS: SELECT if not deleted, write own\n"
        "\n"
        "Triggers:\n"
        "  touch_post() AFTER UPDATE\n"
        "    -> updated_at = NOW()\n"
        "  update_user_post_count()\n"
        "    AFTER INSERT -> post_count++\n"
        "    AFTER DELETE -> post_count--\n"
        "    on user_profiles",
        "#fce7f3", "#ec4899", "#831843", 10)

    # C2 — post_likes (top) + comments (bottom)
    PL_H = (PC_H - 8) // 2
    els += box("c2_pl", 608, PC_Y, 420, PL_H,
        "post_likes\n"
        "  post_id UUID FK posts CASCADE\n"
        "  user_id UUID FK user_profiles CASCADE\n"
        "  PK: (post_id, user_id)\n"
        "  created_at TIMESTAMPTZ\n"
        "  RLS: SELECT all, INSERT/DELETE own\n"
        "\n"
        "Trigger: update_post_like_count()\n"
        "  AFTER INSERT -> like_count++ on posts\n"
        "  AFTER DELETE -> like_count-- on posts",
        "#fce7f3", "#f472b6", "#831843", 10)
    els += box("c3_cmt", 608, PC_Y + PL_H + 8, 420, PC_H - PL_H - 8,
        "comments\n"
        "  id UUID PK\n"
        "  post_id UUID FK posts CASCADE\n"
        "  author_id UUID FK user_profiles CASCADE\n"
        "  parent_comment_id UUID FK self NULL\n"
        "    (NULL=top-level, non-NULL=reply)\n"
        "  content TEXT CHECK(length 1-2000)\n"
        "  is_anonymous BOOL DEFAULT FALSE\n"
        "  like_count INT DEFAULT 0\n"
        "  created_at TIMESTAMPTZ\n"
        "  is_deleted BOOL DEFAULT FALSE\n"
        "\n"
        "Indexes: (post_id, created_at),\n"
        "  parent_comment_id\n"
        "RLS: SELECT if not deleted, write own\n"
        "Trigger: update_post_comment_count()\n"
        "  AFTER INSERT -> comment_count++\n"
        "  AFTER DELETE -> comment_count--\n"
        "  on posts",
        "#fce7f3", "#f472b6", "#831843", 10)

    # C3 — comment_likes (top) + trigger map (bottom)
    CL_H = PC_H // 3
    els += box("c4_cl", 1032, PC_Y, 440, CL_H,
        "comment_likes\n"
        "  comment_id UUID FK comments CASCADE\n"
        "  user_id UUID FK user_profiles CASCADE\n"
        "  PK: (comment_id, user_id)\n"
        "  created_at TIMESTAMPTZ\n"
        "  RLS: SELECT all, INSERT/DELETE own\n"
        "Trigger: update_comment_like_count()\n"
        "  AFTER INSERT -> like_count++ on comments\n"
        "  AFTER DELETE -> like_count-- on comments",
        "#fce7f3", "#f472b6", "#831843", 10)
    els += box("c5_trg", 1032, PC_Y + CL_H + 8, 440, PC_H - CL_H - 8,
        "Complete Trigger Map\n"
        "\n"
        "auth.users INSERT\n"
        "  -> handle_new_user() [profiles]\n"
        "user_profiles UPDATE\n"
        "  -> touch_profile()\n"
        "messages INSERT\n"
        "  -> touch_conversation()\n"
        "posts INSERT/DELETE\n"
        "  -> update_user_post_count()\n"
        "posts UPDATE\n"
        "  -> touch_post()\n"
        "post_likes INSERT/DELETE\n"
        "  -> update_post_like_count()\n"
        "comments INSERT/DELETE\n"
        "  -> update_post_comment_count()\n"
        "comment_likes INSERT/DELETE\n"
        "  -> update_comment_like_count()\n"
        "follows INSERT/DELETE\n"
        "  -> update_follow_counts()",
        "#fdf4ff", "#a855f7", "#4c1d95", 10)

    # C4 — RLS Summary
    els += box("c6_rls", 1476, PC_Y, 1260, PC_H,
        "RLS Policy Summary\n"
        "\n"
        "conversations:\n"
        "  All ops WHERE auth.uid() = user_id\n"
        "\n"
        "messages:\n"
        "  Via JOIN conversations\n"
        "  WHERE auth.uid() = user_id\n"
        "\n"
        "user_profiles:\n"
        "  SELECT: all authenticated\n"
        "  INSERT/UPDATE/DELETE: own uid = user_id\n"
        "\n"
        "posts:\n"
        "  SELECT: WHERE NOT is_deleted\n"
        "  INSERT: authenticated users\n"
        "  UPDATE/DELETE: auth.uid() = author_id\n"
        "\n"
        "post_likes / comment_likes:\n"
        "  SELECT: all authenticated\n"
        "  INSERT/DELETE: own uid = user_id\n"
        "\n"
        "comments:\n"
        "  SELECT: WHERE NOT is_deleted\n"
        "  INSERT: authenticated users\n"
        "  UPDATE/DELETE: auth.uid() = author_id\n"
        "\n"
        "follows:\n"
        "  SELECT: all authenticated\n"
        "  INSERT/DELETE: own uid = follower_id\n"
        "\n"
        "documents_v2 / chunk tables:\n"
        "  Service role only (backend key)\n"
        "  No anon/user RLS policies",
        "#f5f3ff", "#7c3aed", "#3b0764", 10)

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
