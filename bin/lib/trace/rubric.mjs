const DIMENSIONS = ['correctness', 'faithfulness_to_spec', 'task_completion'];

export const QUALITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correctness', 'faithfulness_to_spec', 'task_completion', 'rationale'],
  properties: {
    correctness: { type: 'number' },
    faithfulness_to_spec: { type: 'number' },
    task_completion: { type: 'number' },
    rationale: { type: 'string' },
  },
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function buildJudgePrompt({ agent_role, output, reference } = {}) {
  const role = agent_role && String(agent_role).trim()
    ? String(agent_role).trim()
    : 'an autonomous coding agent';
  const outputText = output != null && String(output).trim()
    ? String(output)
    : '(empty output)';
  const hasReference = reference != null && String(reference).trim().length > 0;
  const referenceBlock = hasReference
    ? `## Reference material (SPEC.md / TASKS.md / RED test text)\n\n${String(reference)}`
    : '## Reference material\n\n(no reference provided — judge on the output alone and do not penalize the absence of reference)';

  return [
    `You are an impartial quality judge scoring the work of ${role}.`,
    'Judge strictly on substance. Be order-neutral and length-neutral: a longer, more verbose, or earlier-listed answer is not better for that reason alone. Ground every score in the reference material when it is present; never reward style over correctness.',
    '',
    '## Agent output under review',
    '',
    outputText,
    '',
    referenceBlock,
    '',
    'Score each dimension as a number in the closed range [0,1] (0 = fails entirely, 1 = fully satisfies):',
    '- correctness: is the work technically correct and free of defects?',
    '- faithfulness_to_spec: does it do exactly what the reference asked, no more and no less?',
    '- task_completion: is the task actually finished, with nothing left half-done?',
    '',
    'Provide a brief rationale (one or two sentences) that justifies the scores.',
    'Respond with a single JSON object with keys: correctness, faithfulness_to_spec, task_completion, rationale.',
  ].join('\n');
}

export function compositeScore(dims) {
  const total = DIMENSIONS.reduce((acc, key) => acc + clamp01(dims?.[key]), 0);
  return clamp01(total / DIMENSIONS.length);
}

export function aggregatePanel(verdicts) {
  const list = Array.isArray(verdicts) ? verdicts : [];
  const n = list.length;

  if (n === 0) {
    return {
      quality_score: 0,
      quality_dims: { correctness: 0, faithfulness_to_spec: 0, task_completion: 0 },
      panel_agreement: 0,
      escalate: true,
      n: 0,
    };
  }

  const quality_dims = {};
  for (const key of DIMENSIONS) {
    const sum = list.reduce((acc, verdict) => acc + clamp01(verdict?.[key]), 0);
    quality_dims[key] = sum / n;
  }

  const quality_score = compositeScore(quality_dims);
  const composites = list.map((verdict) => compositeScore(verdict));

  let panel_agreement = 1;
  if (n > 1) {
    const mean = composites.reduce((acc, c) => acc + c, 0) / n;
    const variance = composites.reduce((acc, c) => acc + (c - mean) ** 2, 0) / n;
    panel_agreement = clamp01(1 - Math.sqrt(variance));
  }

  const straddles = composites.some((c) => c > 0.5) && composites.some((c) => c < 0.5);
  const escalate = panel_agreement < 0.7 || straddles;

  return { quality_score, quality_dims, panel_agreement, escalate, n };
}
