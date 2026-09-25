/**
 * Laya lang.py + router.py port tests (spec 18) — script detection, Latin
 * language guessing, router precedence, typed-decisions workflow matching, and
 * the upstream raw-tuple repo quirk.
 */

import {
  SCRIPT_RANGES,
  STOP,
  SHARED_WORDS,
  NON_EN_DIACRITIC_RATE,
  analyse,
  detectScript,
  guessLatinLanguage,
  isEnglish,
  latinProfile,
  scriptProfile,
} from "../services/laya";
import {
  BUNDLE_REPO,
  DEFAULT_MODELS,
  LayaRouterError,
  matchTypedDecisionsWorkflow,
  normaliseName,
  repoStr,
  route,
} from "../services/laya";

describe("laya script detection (detectScript)", () => {
  it("classifies Latin, Devanagari, kana, Arabic, Greek", () => {
    expect(detectScript("hello world")).toBe("latin");
    expect(detectScript("नमस्ते दुनिया")).toBe("devanagari");
    expect(detectScript("こんにちは")).toBe("kana");
    expect(detectScript("مرحبا بالعالم")).toBe("arabic");
    expect(detectScript("αβγ δ")).toBe("greek");
  });

  it("returns unknown when no letters present", () => {
    expect(detectScript("!!! 123")).toBe("unknown");
    expect(detectScript("")).toBe("unknown");
  });

  it("first maximal wins on ties (Python max: strict-greater keeps the first)", () => {
    // greek appears before devanagari in SCRIPT_RANGES; equal counts keep greek
    expect(detectScript("αन")).toBe("greek");
  });

  it("table covers the expected scripts (25 entries)", () => {
    expect(SCRIPT_RANGES).toHaveLength(25);
    expect(SCRIPT_RANGES.map(([n]) => n)).toContain("han");
    expect(SCRIPT_RANGES.map(([n]) => n)).toContain("ethiopic");
  });
});

describe("laya scriptProfile", () => {
  it("fraction of alphabetic chars per script, zeros dropped", () => {
    expect(scriptProfile("नमस्ते")).toEqual({ devanagari: 1 });
    // "hello नमस्ते" = 5 latin + 4 devanagari LETTERS (् and े are marks,
    // excluded like Python's \w/isalnum) → 5/9 and 4/9
    expect(scriptProfile("hello नमस्ते")).toEqual({ latin: 5 / 9, devanagari: 4 / 9 });
    expect(scriptProfile("!!!")).toEqual({});
  });
});

describe("laya latinProfile / guessLatinLanguage", () => {
  it("names English on en hits + no non-English letters", () => {
    const p = latinProfile("the customer wants a refund please");
    expect(p.englishHits).toBe(2); // the, please
    expect(p.language).toBe("en");
    expect(p.looksNonEnglish).toBe(false);
  });

  it("names French on fr-only words with the en+2 margin", () => {
    const p = latinProfile("bonjour merci pour tout");
    expect(p.language).toBe("fr");
    expect(p.looksNonEnglish).toBe(false); // no diacritics → margin branch already fired
    expect(guessLatinLanguage("bonjour merci pour tout")).toBe("fr");
  });

  it("does not name a language on shared words alone", () => {
    // "la"/"le" are claimed by fr, es, it → no exclusive evidence
    const p = latinProfile("la la la la");
    expect(p.language).toBeNull();
    expect(p.looksNonEnglish).toBe(false);
  });

  it("needs 4+ words; short text is undecided but diacritic-aware", () => {
    const short = latinProfile("bonjour");
    expect(short.language).toBeNull();
    expect(short.englishHits).toBe(0);
    const diac = latinProfile("café");
    expect(diac.language).toBeNull();
    expect(diac.looksNonEnglish).toBe(true);
  });

  it("shared words do not count as exclusive evidence", () => {
    expect(SHARED_WORDS.has("la")).toBe(true); // fr/es/it
    expect(SHARED_WORDS.has("is")).toBe(true); // en/de/nl
  });

  it("STOP tables exist for the 8 Romance/Germanic languages", () => {
    for (const lg of ["en", "fr", "de", "es", "pt", "it", "nl", "ro"]) {
      expect(STOP[lg]).toBeInstanceOf(Set);
    }
    expect(STOP.en.has("the")).toBe(true);
    expect(STOP.ro.has("și")).toBe(true);
    expect(STOP.nl.has("het")).toBe(true);
  });

  it("NON_EN_DIACRITIC_RATE constant matches Python", () => {
    expect(NON_EN_DIACRITIC_RATE).toBe(0.02);
  });
});

describe("laya analyse", () => {
  it("English Latin state: english, no undecided flag", () => {
    const a = analyse("the customer wants a refund please");
    expect(a.script).toBe("latin");
    expect(a.language).toBe("en");
    expect(a.isEnglish).toBe(true);
    expect(a.languageUndecided).toBe(false);
    expect(a.nonLatinFraction).toBe(0);
    expect(a.diacriticRate).toBe(0);
  });

  it("non-Latin state: not english, undecided, 100% non-Latin", () => {
    const a = analyse("नमस्ते दुनिया");
    expect(a.script).toBe("devanagari");
    expect(a.isEnglish).toBe(false);
    expect(a.languageUndecided).toBe(true);
    expect(a.nonLatinFraction).toBe(1);
  });

  it("no letters: unknown script, treated as english/undecided", () => {
    const a = analyse("!!! 123");
    expect(a.script).toBe("unknown");
    expect(a.isEnglish).toBe(true);
    expect(a.languageUndecided).toBe(true);
  });

  it("state objects are flattened for detection", () => {
    const a = analyse({ message: "the quick brown fox jumps over the lazy dog", meta: { note: "" } });
    expect(a.script).toBe("latin");
    expect(a.isEnglish).toBe(true);
  });

  it("diacritic Latin without stopword evidence: undecided AND not english", () => {
    const a = analyse("château rêve hôtel élève");
    expect(a.language).toBeNull();
    expect(a.languageUndecided).toBe(true);
    expect(a.isEnglish).toBe(false);
    expect(a.diacriticRate).toBeGreaterThan(0);
  });

  it("French state: not english", () => {
    expect(isEnglish("bonjour merci pour tout")).toBe(false);
    expect(isEnglish("नमस्ते")).toBe(false);
    expect(isEnglish("the quick brown fox jumps over the dog")).toBe(true);
  });
});

describe("laya router", () => {
  it("explicit model wins; aliases resolve; reason uses Python %r", () => {
    const d = route("ignored", null, { model: "en" });
    expect(d.model).toBe("english");
    expect(d.reason).toBe(`explicit model='en'`);
    expect(d.detection).toBeNull();
    expect(d.repo).toBe(repoStr(DEFAULT_MODELS.english));
    expect(d.repo).toBe(BUNDLE_REPO);
  });

  it("explicit task (typed_decisions / TYPED-DECISIONS) resolves", () => {
    expect(route(null, null, { task: "typed_decisions" }).model).toBe("typed-decisions");
    expect(route(null, null, { task: "TYPED-DECISIONS" }).model).toBe("typed-decisions");
    expect(route(null, null, { task: "TYPED-DECISIONS" }).reason).toBe(`explicit task='TYPED-DECISIONS'`);
  });

  it("precedence: model > task > workflow > lang > detection", () => {
    const wf = { action: "a", needs_review: "r", outcome: "o", risk: "r", urgency: "u" };
    const d = route(null, wf, { model: "en", task: "typed", lang: "de", autoTaskDetection: true });
    expect(d.model).toBe("english");

    const t = route(null, wf, { task: "typed", lang: "de", autoTaskDetection: true });
    expect(t.model).toBe("typed-decisions");

    const l = route(null, null, { lang: "de" });
    expect(l.model).toBe("multilingual");
    expect(l.reason).toBe(`explicit lang='de'`);
  });

  it("lang: en/en-* → english, others → multilingual", () => {
    expect(route(null, null, { lang: "en" }).model).toBe("english");
    expect(route(null, null, { lang: "EN-GB" }).model).toBe("english");
    expect(route(null, null, { lang: "fr" }).model).toBe("multilingual");
    expect(route(null, null, { lang: "hi" }).model).toBe("multilingual");
  });

  it("typed-decisions workflow auto-detection: exact id-set match only", () => {
    const wf = { action: "a", needs_review: "r", outcome: "o", risk: "r", urgency: "u" };
    expect(matchTypedDecisionsWorkflow(wf)).toBe("agent_trace_observability");
    expect(matchTypedDecisionsWorkflow({ ...wf, extra: "e" })).toBeNull(); // size mismatch
    expect(matchTypedDecisionsWorkflow(null)).toBeNull();

    const d = route(null, wf, { autoTaskDetection: true });
    expect(d.model).toBe("typed-decisions");
    expect(d.workflow).toBe("agent_trace_observability");
    expect(d.reason).toBe(`question ids match the 'agent_trace_observability' typed-decisions workflow`);
    // Upstream quirk: repo is the RAW (repo, subfolder) tuple in this branch
    expect(d.repo).toEqual(["convaiinnovations/laya", "typed-decisions"]);
  });

  it("workflow detected but not opted-in → falls through to detection", () => {
    const wf = { action: "a", needs_review: "r", outcome: "o", risk: "r", urgency: "u" };
    const d = route(null, wf, {});
    expect(d.workflow).toBe("agent_trace_observability"); // still reported
    expect(d.model).toBe("english"); // no letters → default
  });

  it("all four workflows match by signature", () => {
    expect(matchTypedDecisionsWorkflow({ action: "a", category: "c", churn_risk: "r", needs_human: "h", urgency: "u" }))
      .toBe("customer_service");
    expect(matchTypedDecisionsWorkflow({ discrepancy_severity: "d", disposition: "d", duplicate: "d", matches_order: "d", urgency: "u" }))
      .toBe("invoice_processing");
    expect(matchTypedDecisionsWorkflow({ credential_compromise: "c", disposition: "d", severity: "s", true_positive: "t", urgency: "u" }))
      .toBe("security_incidents");
  });

  it("English Latin detection → english checkpoint", () => {
    const d = route("the customer wants a refund please");
    expect(d.model).toBe("english");
    expect(d.reason).toBe("English Latin text");
    expect(d.detection?.isEnglish).toBe(true);
  });

  it("non-Latin detection → multilingual, with script % reason", () => {
    const d = route("नमस्ते दुनिया");
    expect(d.model).toBe("multilingual");
    expect(d.reason).toContain("non-Latin script (devanagari, 100% of letters)");
  });

  it("unidentified Latin with diacritics → multilingual", () => {
    const d = route("château rêve hôtel élève");
    expect(d.model).toBe("multilingual");
    expect(d.reason).toMatch(/Latin script, language not identified but \d+% non-English letters/);
  });

  it("named non-English Latin → multilingual with language reason", () => {
    const d = route("bonjour merci pour tout");
    expect(d.model).toBe("multilingual");
    expect(d.reason).toBe(`Latin script but language looks like 'fr', not English`);
  });

  it("no letters → default (english default, or defaultModel)", () => {
    const d = route("!!! 123");
    expect(d.model).toBe("english");
    expect(d.reason).toBe(`no letters detected in state; using default (english)`);
    const m = route("!!! 123", null, { defaultModel: "multi" });
    expect(m.model).toBe("multilingual");
    expect(m.reason).toContain("using default (multilingual)");
  });

  it("normaliseName: case-insensitive + alias resolve; unknown throws ValueError-style", () => {
    expect(normaliseName("En")).toBe("english");
    expect(normaliseName(" TYPED ")).toBe("typed-decisions");
    expect(normaliseName("ml")).toBe("multilingual");
    expect(repoStr(DEFAULT_MODELS["typed-decisions"])).toBe("convaiinnovations/laya/typed-decisions");
    expect(() => normaliseName("bogus")).toThrow(LayaRouterError);
    expect(() => normaliseName("bogus")).toThrow(/unknown model 'bogus'; choose one of \['english', 'multilingual', 'typed-decisions'\]/);
    expect(() => normaliseName("bogus")).toThrow(/or an alias: /);
  });
});