// Turns a raw IntegrityCase into a plain-language "originality & source" read for
// the Judge HUD and the Review console. Pure — no I/O. Never asserts wrongdoing;
// mirrors the engine's "evidence, not a verdict" stance.

import type { IntegrityCase, SourceMatch } from './reviewApi';

export interface OriginalitySource {
  domain: string;
  url: string;
  title: string;
  sourceType: string;
  credibility: number;
  peakSimilarity: number; // 0..1 word-for-word overlap of the best-matching phrase
  attributed: boolean;
  phrase: string;
  atMs: number | null;
}

export interface OriginalityRead {
  /** 0..100. 100 = nothing traced to an outside source. */
  index: number;
  label: 'original' | 'mostly-original' | 'notable-overlap' | 'heavy-overlap';
  headline: string;
  /** How the delivery reads: spontaneous vs assembled/rehearsed. */
  naturalness: 'reads-natural' | 'reads-rehearsed' | 'unclear';
  naturalnessNote: string;
  matchedPhraseCount: number;
  peakSimilarity: number; // 0..1 across all sources
  peakSource: OriginalitySource | null;
  sources: OriginalitySource[];
  crossParticipant: { maxSimilarity: number; others: Array<{ label: string; similarity: number; phrases: string[] }> };
  unattributedCount: number;
  searchCoverage: string;
  caveat: string;
  riskLevel: IntegrityCase['riskLevel'];
  confidence: IntegrityCase['confidence'];
}

const LABEL_TEXT: Record<OriginalityRead['label'], string> = {
  original: 'Reads as original',
  'mostly-original': 'Mostly original — minor echoes of known material',
  'notable-overlap': 'Notable overlap with known sources',
  'heavy-overlap': 'Heavy overlap — treat as unoriginal pending human review',
};

const isAttributedClass = (qc: string) => /attribut|quoted|cited/i.test(qc);

function dedupeSources(matches: SourceMatch[]): OriginalitySource[] {
  const byDomain = new Map<string, OriginalitySource>();
  for (const m of matches) {
    const attributed = isAttributedClass(m.quotationClass);
    const existing = byDomain.get(m.domain);
    if (!existing || m.exactSimilarity > existing.peakSimilarity) {
      byDomain.set(m.domain, {
        domain: m.domain,
        url: m.sourceUrl,
        title: m.title,
        sourceType: m.sourceType,
        credibility: m.credibility,
        peakSimilarity: m.exactSimilarity,
        attributed,
        phrase: m.phrase,
        atMs: m.atMs,
      });
    }
  }
  return [...byDomain.values()].sort((a, b) => b.peakSimilarity - a.peakSimilarity);
}

export function readOriginality(c: IntegrityCase): OriginalityRead {
  const matches = c.sourceMatches ?? [];
  const sources = dedupeSources(matches);
  const unattributedCount = sources.filter((s) => !s.attributed).length;
  const peakSimilarity = sources.reduce((m, s) => Math.max(m, s.peakSimilarity), 0);

  // "Copied intensity" mirrors the engine's own capping logic: one strong
  // unattributed match ≈ moderate, two independent ≈ heavy.
  const intensity = Math.min(
    1,
    matches.reduce((sum, m) => {
      const w = isAttributedClass(m.quotationClass) ? 0.3 : 1;
      return sum + w * (m.significance || m.exactSimilarity * 0.6);
    }, 0),
  );
  const crossMax = (c.participantMatches ?? []).reduce((m, p) => Math.max(m, p.similarity), 0);
  const index = Math.max(0, Math.round(100 * (1 - Math.max(intensity, crossMax * 0.9))));

  const label: OriginalityRead['label'] =
    index >= 85 ? 'original' : index >= 65 ? 'mostly-original' : index >= 40 ? 'notable-overlap' : 'heavy-overlap';

  const headline =
    sources.length === 0
      ? 'No phrasing traced to an external source in the searched corpus.'
      : `${sources.length} source${sources.length === 1 ? '' : 's'} matched — strongest is ${Math.round(
          peakSimilarity * 100,
        )}% word-for-word with ${sources[0]!.domain}${sources[0]!.attributed ? ' (attributed in the speech)' : ' (no attribution heard)'}.`;

  // Naturalness: rehearsed/assembled read comes from preparedness + a large
  // style shift, and is only interesting alongside unattributed overlap.
  const prep = (c.preparedness?.classification ?? '').toLowerCase();
  const rehearsed = /rehears|scripted|prepared-heavy|highly/.test(prep);
  const bigStyleShift = !!c.styleAnalysis?.hasBaseline && (c.styleAnalysis?.overallShift ?? 0) >= 0.5;
  let naturalness: OriginalityRead['naturalness'] = 'unclear';
  let naturalnessNote = 'Not enough signal to say how spontaneous the delivery was.';
  if (rehearsed || bigStyleShift) {
    naturalness = 'reads-rehearsed';
    naturalnessNote =
      (rehearsed ? 'Delivery indicators lean rehearsed/assembled' : 'Delivery deviates sharply from this speaker’s own baseline') +
      (unattributedCount > 0 ? ' — and some phrasing matches outside sources without attribution.' : ' — no unattributed source matches, so this alone is weak.');
  } else if (c.preparedness) {
    naturalness = 'reads-natural';
    naturalnessNote = 'Pace, pauses and phrasing read as spontaneous rather than recited.';
  }

  return {
    index,
    label,
    headline: `${LABEL_TEXT[label]}. ${headline}`,
    naturalness,
    naturalnessNote,
    matchedPhraseCount: new Set(matches.map((m) => m.phrase)).size,
    peakSimilarity,
    peakSource: sources[0] ?? null,
    sources,
    crossParticipant: {
      maxSimilarity: crossMax,
      others: (c.participantMatches ?? []).map((p) => ({
        label: p.otherLabel,
        similarity: p.similarity,
        phrases: (p.sharedDistinctivePhrases ?? []).slice(0, 3),
      })),
    },
    unattributedCount,
    searchCoverage: c.searchCoverage,
    caveat: c.notProvedNote,
    riskLevel: c.riskLevel,
    confidence: c.confidence,
  };
}
