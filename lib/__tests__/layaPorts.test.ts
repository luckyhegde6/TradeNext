/**
 * Laya P1 port tests — pure helpers (version, qtypes, serialize, calibration,
 * collate, presets, email). Values assert the Python-reference outputs from
 * `laya/` @ c7527708 (spec 18; see `.agents/specs/18-laya-real-inference.md`).
 */

import {
  LAYA_CHECKPOINT,
  LAYA_VERSION,
  QTYPES,
  QTYPE_NAMES,
  QtypeName,
  qtypeIndex,
  qtypeName,
  pythonDumps,
  renderCriterion,
  renderOptions,
  serializeState,
  TEMP_MAX,
  TEMP_MIN,
  calibrateTemperature,
  clampTemperature,
  clampedTemperatureTables,
  confidenceFromProbs,
  collateItems,
  eceScore,
  pyG,
  tempBucket,
  cleanEmailBody,
  emailState,
  triageQuestions,
  emailQuestions,
  guardQuestions,
  moderationQuestions,
  routerQuestions,
} from "../services/laya";

describe("laya version", () => {
  it("pins the Python package version + HF checkpoint", () => {
    expect(LAYA_VERSION).toBe("0.3.6");
    expect(LAYA_CHECKPOINT.hfRepo).toBe("nvkudva/laya-web-q8");
    expect(LAYA_CHECKPOINT.subfolder).toBe("v1");
    expect(LAYA_CHECKPOINT.modelName).toBe("rl-agent");
    expect(LAYA_CHECKPOINT.encoder).toBe("answerdotai/ModernBERT-large");
    expect(LAYA_CHECKPOINT.artifacts).toHaveLength(7);
    expect(LAYA_CHECKPOINT.artifacts).toContain("rl_agent_config.json");
  });
});

describe("laya qtypes", () => {
  it("maps names <-> indices as Python (choice=0, score=1, noul=2)", () => {
    expect(QTYPES).toEqual({ choice: 0, score: 1, noul: 2 });
    expect(QTYPE_NAMES).toEqual({ 0: "choice", 1: "score", 2: "noul" });
    for (const name of Object.keys(QTYPES) as QtypeName[]) {
      const idx = qtypeIndex(name);
      expect(typeof idx).toBe("number");
      expect(qtypeName(idx)).toBe(name);
    }
  });
});

describe("laya serialize (pythonDumps / render*)", () => {
  it("renders Python-style json.dumps separators (', ' and ': ')", () => {
    expect(pythonDumps({ a: 1, b: [true, null], c: "x" })).toBe('{"a": 1, "b": [true, null], "c": "x"}');
    expect(pythonDumps([1, "two", false])).toBe('[1, "two", false]');
    expect(pythonDumps(null)).toBe("null");
  });

  it("renderCriterion: string passthrough, else dumps with default=str", () => {
    expect(renderCriterion("plain")).toBe("plain");
    expect(renderCriterion({ k: "v" })).toBe('{"k": "v"}');
  });

  it("renderOptions: choice — null/'' are descriptions-absent, 0/False are descriptions", () => {
    const q = { t: "choice" as const, ins: "i", crit: { refund: null, other: "", zero: 0, fls: false } };
    expect(renderOptions(q)).toEqual(["refund", "other", "zero: 0", "fls: false"]);
  });

  it("renderOptions: score — 'level i: desc'", () => {
    expect(renderOptions({ t: "score" as const, ins: "i", crit: ["calm", "angry"] })).toEqual([
      "level 0: calm",
      "level 1: angry",
    ]);
  });

  it("renderOptions: noul — default hold texts when crit absent", () => {
    expect(renderOptions({ t: "noul" as const, ins: "i" })).toEqual([
      "false: no, the statement does not hold",
      "true: yes, the statement holds",
    ]);
  });

  it("serializeState: string passthrough, dict python-dumped", () => {
    expect(serializeState("hello")).toBe("hello");
    expect(serializeState({ message: "hi" })).toBe('{"message": "hi"}');
  });
});

describe("laya calibration", () => {
  it("tempBucket keys match Python (temperature_by_options keys)", () => {
    expect(tempBucket(0, 2)).toBe("choice:2");
    expect(tempBucket(0, 3)).toBe("choice:3-5");
    expect(tempBucket(0, 7)).toBe("choice:6-10");
    expect(tempBucket(1, 12)).toBe("score:11+");
    expect(tempBucket(2, 2)).toBe("noul:2");
  });

  it("clampTemperature: Python float() coercion + [0.5, 5.0] clamp", () => {
    expect(clampTemperature(1.7)).toBe(1.7);
    expect(clampTemperature("2.5")).toBe(2.5);
    expect(clampTemperature(0.1)).toBe(TEMP_MIN);
    expect(clampTemperature(9)).toBe(TEMP_MAX);
    expect(clampTemperature("bogus")).toBe(1.0);
    expect(clampTemperature(NaN)).toBe(1.0);
  });

  it("calibrateTemperature: bucket override wins, table fallback, 1e-4 floor", () => {
    const cfg = {
      temperature: [1.0, 2.0, 3.0],
      temperatureByOptions: { "choice:3-5": 0.8 } as Record<string, number>,
    };
    expect(calibrateTemperature(cfg, 0, 3)).toBe(0.8);
    expect(calibrateTemperature(cfg, 0, 2)).toBe(1.0);
    expect(calibrateTemperature(cfg, 1, 2)).toBe(2.0);
    const cfg0 = { temperature: [0, 2.0, 3.0], temperatureByOptions: {} };
    expect(calibrateTemperature(cfg0, 0, 2)).toBe(1e-4);
  });

  it("clampedTemperatureTables reports rejected entries with Python %.4g", () => {
    const raw = {
      temperature: [1.7601518630981445, 9, 1.983399510383606],
      temperatureByOptions: { "choice:3-5": 1.7601518630981445, "score:3-5": 5.5 } as Record<string, number>,
    };
    const out = clampedTemperatureTables(raw);
    expect(out.temperature).toEqual([1.7601518630981445, TEMP_MAX, 1.983399510383606]);
    expect(out.temperatureByOptions["score:3-5"]).toBe(TEMP_MAX);
    expect(out.rejected).toEqual(["score:3-5=5.5", "temperature[1]=9"]);
    expect(raw.temperature).toEqual([1.7601518630981445, 9, 1.983399510383606]); // untouched
  });

  it("pyG matches Python '%.4g'", () => {
    expect(pyG(1.7601518630981445)).toBe("1.76");
    expect(pyG(0.10058280825614929)).toBe("0.1006");
    expect(pyG(5)).toBe("5");
  });

  it("confidenceFromProbs: entropy confidence, natural log, 1e-12 clip", () => {
    expect(confidenceFromProbs([0.5, 0.5], 2)).toBeCloseTo(0, 10);
    expect(confidenceFromProbs([1, 0], 2)).toBeCloseTo(1, 10);
    expect(confidenceFromProbs([0.9, 0.1], 2)).toBeGreaterThan(0.5);
    expect(confidenceFromProbs([0.5, 0.5, 0.5, 0.5], 1)).toBe(1.0); // k<2 → 1
  });

  it("eceScore bins confidence vs correctness", () => {
    // bin (0.5, 1]: confMean 0.8, corrMean 0.5, weight 1 → |0.8-0.5| = 0.3
    expect(eceScore([0.9, 0.7], [1, 0], 2)).toBeCloseTo(0.3, 10);
    expect(eceScore([], [])).toBeNaN();
  });
});

describe("laya collate", () => {
  it("returns null for an empty batch (Python None)", () => {
    expect(collateItems([[], []], 0)).toBeNull();
  });

  it("pads to batch max L/kmax, fills attention + marker masks", () => {
    const batch = collateItems(
      [
        [
          { ids: [1, 2, 3], markers: [1], qtype: 0, label: 1 },
          { ids: [9], markers: [0, 5], qtype: 2 },
        ],
      ],
      0,
    );
    expect(batch).not.toBeNull();
    expect(batch!.inputIds).toEqual([
      [1, 2, 3],
      [9, 0, 0],
    ]);
    expect(batch!.attentionMask).toEqual([
      [1, 1, 1],
      [1, 0, 0],
    ]);
    expect(batch!.markerPos).toEqual([
      [1, 0],
      [0, 5],
    ]);
    expect(batch!.markerMask).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(batch!.qtype).toEqual([0, 2]);
    expect(batch!.label).toEqual([1, -1]); // default label -1
    expect(batch!.meta).toEqual([
      { qtype: 0, label: 1 },
      { qtype: 2 },
    ]); // ids/markers/target excluded
    expect(batch!.target).toBeUndefined(); // NOT emitted when none carried
  });

  it("emits target rows only when at least one item carries target", () => {
    const batch = collateItems(
      [[{ ids: [1], markers: [], qtype: 0, target: [2, 3] }, { ids: [1], markers: [], qtype: 1 }]],
      0,
    );
    // kmax = 0 (no markers anywhere) → pad row is empty, like Python's [0]*kmax
    expect(batch!.target).toEqual([
      [2, 3],
      [],
    ]);
    expect(batch!.meta).toEqual([{ qtype: 0 }, { qtype: 1 }]);
  });
});

describe("laya email", () => {
  it("cleanEmailBody drops quoted history, signature, disclaimer", () => {
    const dirty = [
      "My account was charged twice.",
      "",
      "On Fri, Sep 1 at 09:00 wrote:",
      "> Please fix it now",
      "",
      "Thanks,",
      "Alice",
      "",
      "--",
      "Alice Smith",
      "This email is confidential and intended only for the addressee.",
    ].join("\n");
    const clean = cleanEmailBody(dirty);
    expect(clean).toContain("My account was charged twice.");
    expect(clean).not.toContain("wrote:");
    expect(clean).not.toContain("Please fix it now");
    expect(clean).not.toContain("confidential");
    expect(clean).not.toContain("--");
  });

  it("emailState: trimmed subject, cleaned body, conditional from, extras", () => {
    const state = emailState("  Refund  ", "  body with \r\n quoted >x  ", "sender@x.io", true, {
      campaign: "renewal",
      priority: undefined,
    });
    expect(state.subject).toBe("Refund");
    expect(state.body).toContain("body with");
    expect(state.from).toBe("sender@x.io");
    expect(state.campaign).toBe("renewal");
    expect(state.priority).toBeUndefined(); // null/undefined dropped
  });
});

describe("laya presets", () => {
  it("triageQuestions: five typed questions, insertion order", () => {
    const q = triageQuestions();
    expect(Object.keys(q)).toEqual(["intent", "is_urgent", "frustration", "refund_requested", "churn_risk"]);
    expect(q.intent.type).toBe("choice");
    expect(Object.keys(q.intent.criteria as Record<string, unknown>)).toEqual([
      "refund",
      "technical_help",
      "billing_question",
      "information",
      "cancellation",
      "other",
    ]);
    expect(q.is_urgent.type).toBe("noul");
    expect(q.frustration.type).toBe("score");
    expect((q.frustration.criteria as unknown[])).toHaveLength(4);
  });

  it("emailQuestions: category is choice with default categories, defaults override", () => {
    const q = emailQuestions();
    expect(q.category.type).toBe("choice");
    expect(Object.keys(q.category.criteria as Record<string, unknown>)).toEqual([
      "billing",
      "technical",
      "sales",
      "security",
      "hr",
      "other",
    ]);
    expect(q.is_spam.type).toBe("noul");
    expect(q.is_phishing.type).toBe("noul");
    expect(q.urgency.type).toBe("score");
    expect(q.needs_reply.type).toBe("noul");
  });

  it("guardQuestions: jailbreak/injection/sensitive/harm/topic", () => {
    const q = guardQuestions();
    expect(Object.keys(q)).toEqual([
      "jailbreak",
      "prompt_injection",
      "sensitive_data",
      "harm_severity",
      "topic",
    ]);
    expect(q.jailbreak.type).toBe("noul");
    expect(q.harm_severity.type).toBe("score");
    expect(q.topic.type).toBe("choice");
  });

  it("moderationQuestions + routerQuestions shapes", () => {
    const m = moderationQuestions();
    expect(Object.keys(m)).toEqual(["toxic", "harassment", "threat", "spam", "severity"]);
    expect(m.threat.type).toBe("noul");
    expect(m.severity.type).toBe("score");
    const r = routerQuestions();
    expect(Object.keys(r)).toEqual(["difficulty", "domain", "needs_tools", "is_sensitive"]);
    expect(r.difficulty.type).toBe("score");
    expect((r.difficulty.criteria as unknown[])).toHaveLength(4);
    expect(r.domain.type).toBe("choice");
    expect(Object.keys(r.domain.criteria as Record<string, unknown>)).toHaveLength(6);
  });
});