// A deterministic, offline stand-in for a real web search (spec §119). It ranks
// a small seeded corpus by shingle overlap with the query. Swap in a real
// provider behind SourceSearchProvider without touching the engine.

import { classifyDomain } from './SourceSearchProvider.ts';
import type { SourceDoc, SourceHit, SourceSearchProvider } from './SourceSearchProvider.ts';
import { containment, sentences, shingles } from '../text.ts';

export const SEED_CORPUS: SourceDoc[] = [
  {
    url: 'https://www.imf.org/en/Publications/WEO/trade-and-workers',
    domain: 'imf.org',
    title: 'Trade Openness and Labour Market Outcomes',
    sourceType: 'government',
    text:
      'When economies open to trade without adjustment assistance for displaced workers, the losses are concentrated in specific communities while the gains are diffuse and spread thinly across consumers. The net welfare effect over the last decade has been positive but the distribution has been deeply uneven. Regulatory credibility matters: carbon markets collapse when the underlying regulatory commitment is not believed by participants.',
  },
  {
    url: 'https://en.wikipedia.org/wiki/Comparative_advantage',
    domain: 'en.wikipedia.org',
    title: 'Comparative advantage — Wikipedia',
    sourceType: 'reference',
    text:
      'The law of comparative advantage describes how, under free trade, an agent will produce more of and consume less of a good for which it has a comparative advantage. Comparative advantage is the economic reality describing the work gains from trade for individuals, firms, or nations.',
  },
  {
    url: 'https://www.reuters.com/markets/trade-policy-working-people',
    domain: 'reuters.com',
    title: 'Analysis: Has trade policy helped working people?',
    sourceType: 'news',
    text:
      'The evidence from the last decade is honestly pretty mixed, but on balance most economists argue that liberalisation did not help the median worker in advanced economies. Import competition produced sharp, localised job losses that adjustment programmes never fully offset.',
  },
  {
    url: 'https://climatepolicyblog.substack.com/p/carbon-markets',
    domain: 'climatepolicyblog.substack.com',
    title: 'Why carbon markets keep failing',
    sourceType: 'blog',
    text:
      'Carbon markets collapse when regulatory credibility erodes. If firms expect the cap to be loosened under political pressure, the price signal disappears and the whole mechanism unwinds. This is the single most important design lesson from the last twenty years of emissions trading.',
  },
  {
    url: 'https://www.reddit.com/r/debate/comments/trade_case',
    domain: 'reddit.com',
    title: 'r/debate — my trade policy case file',
    sourceType: 'forum',
    text:
      'Claim: trade policy has not helped workers. Example: the China shock. Statistic: 2.4 million manufacturing jobs. Rebuttal to the growth argument: aggregate GDP gains do not reach displaced workers because retraining programmes have low take-up.',
  },
  {
    url: 'https://www.oecd.org/employment/adjustment-assistance-review',
    domain: 'oecd.org',
    title: 'Trade Adjustment Assistance: A Review',
    sourceType: 'government',
    text:
      'Programmes that pair open markets with serious adjustment assistance — wage insurance, mobility grants, and portable benefits — show materially better outcomes for affected workers than trade liberalisation alone.',
  },
  {
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    domain: 'en.wikipedia.org',
    title: 'Artificial intelligence — Wikipedia',
    sourceType: 'reference',
    text:
      'Artificial intelligence is the intelligence of machines or software, as opposed to the intelligence of humans or other animals. The field studies methods and software that enable machines to perceive their environment and use learning and intelligence to take actions that maximise their chances of achieving defined goals. High-profile applications include advanced web search engines, recommendation systems, generative and creative tools, and autonomous vehicles.',
  },
  {
    url: 'https://www.nature.com/articles/climate-tipping-points-review',
    domain: 'nature.com',
    title: 'Climate tipping points — too risky to bet against',
    sourceType: 'academic',
    text:
      'The stability and resilience of the planet is in peril. International action, not just words, must reflect this. Evidence is mounting that some tipping points could be exceeded within the range of warming the world has already committed to. A cascade of abrupt shifts in the climate system could be triggered if several tipping points are crossed in succession, and the risk is now uncomfortably high.',
  },
  {
    url: 'https://www.pewresearch.org/internet/social-media-and-democracy',
    domain: 'pewresearch.org',
    title: 'Social media, misinformation, and democratic engagement',
    sourceType: 'reference',
    text:
      'Social media platforms have lowered the cost of political participation and let movements organise at unprecedented speed, but the same architecture rewards outrage and novelty over accuracy. Algorithmic amplification means that false claims frequently travel farther and faster than corrections, and repeated exposure alone increases the perceived truth of a statement.',
  },
  {
    url: 'https://www.who.int/publications/universal-health-coverage-brief',
    domain: 'who.int',
    title: 'Universal health coverage: the economic case',
    sourceType: 'government',
    text:
      'Universal health coverage means that all people have access to the full range of quality health services they need, when and where they need them, without financial hardship. Every year, roughly 100 million people are pushed into extreme poverty because they have to pay for health care out of their own pockets. Investing in primary health care is the most cost-effective route to coverage.',
  },
  {
    url: 'https://www.brookings.edu/research/automation-and-the-future-of-work',
    domain: 'brookings.edu',
    title: 'Automation and the future of work',
    sourceType: 'reference',
    text:
      'Automation will not produce mass unemployment overnight, but it will change the task content of most jobs and concentrate the disruption on routine, middle-wage occupations. Workers without a college degree are the most exposed, and the policy response — portable benefits, wage insurance, and lifelong retraining — matters more than the pace of the technology itself.',
  },
  {
    url: 'https://www.unesco.org/en/education-transforms-lives',
    domain: 'unesco.org',
    title: 'Education transforms lives',
    sourceType: 'government',
    text:
      'Education is a human right, a public good and a public responsibility. It is the single most powerful lever we have to reduce poverty, improve health, achieve gender equality, and foster peace. Each additional year of schooling raises an individual’s earnings by around ten percent and lifts a country’s long-run growth rate.',
  },
  {
    url: 'https://en.wikipedia.org/wiki/Gettysburg_Address',
    domain: 'en.wikipedia.org',
    title: 'Gettysburg Address — Wikipedia',
    sourceType: 'reference',
    text:
      'Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. Government of the people, by the people, for the people, shall not perish from the earth.',
  },
  {
    url: 'https://www.themarshallproject.org/records/mass-incarceration-explainer',
    domain: 'themarshallproject.org',
    title: 'Mass incarceration, explained',
    sourceType: 'news',
    text:
      'The United States incarcerates more people, both per capita and in absolute terms, than any other nation. Decades of mandatory minimum sentences, cash bail, and the war on drugs drove the prison population up fivefold, with the burden falling disproportionately on Black and low-income communities. Evidence shows that longer sentences deliver little additional deterrence once certainty of punishment is held constant.',
  },
  {
    url: 'https://www.economist.com/leaders/the-case-for-nuclear-power',
    domain: 'economist.com',
    title: 'The case for nuclear power',
    sourceType: 'news',
    text:
      'Nuclear power is the safest form of energy humanity has ever used, measured by deaths per unit of electricity generated, and it is the only proven low-carbon source that can supply firm, dispatchable power at scale. The real obstacles are not technical but financial and political: first-of-a-kind projects run over budget, and public fear is calibrated to accidents rather than to the steady toll of fossil fuels.',
  },
];

export class MockSourceSearchProvider implements SourceSearchProvider {
  readonly name = 'mock';
  readonly coverageNote =
    `Local demonstration corpus of ${SEED_CORPUS.length} seeded documents — not a live web search. ` +
    'It only covers a handful of common debate topics; a real deployment plugs a web ' +
    'search provider in behind the same interface for full coverage.';

  private readonly corpus: Array<SourceDoc & { grams: Set<string> }>;

  constructor(docs: SourceDoc[] = SEED_CORPUS) {
    this.corpus = docs.map((d) => ({ ...d, grams: shingles(d.text, 3) }));
  }

  async search(query: string, opts: { limit?: number } = {}): Promise<SourceHit[]> {
    const qGrams = shingles(query, 3);
    const scored = this.corpus
      .map((d) => {
        const score = containment(qGrams, d.grams);
        const best = bestSentence(query, d.text);
        return { d, score, snippet: best };
      })
      .filter((x) => x.score >= 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit ?? 3);

    return scored.map(({ d, snippet }) => ({
      url: d.url,
      domain: d.domain,
      title: d.title,
      snippet,
      text: d.text,
      sourceType: d.sourceType ?? classifyDomain(d.domain),
    }));
  }
}

function bestSentence(query: string, docText: string): string {
  const q = shingles(query, 3);
  let best = '';
  let bestScore = -1;
  for (const s of sentences(docText)) {
    const score = containment(q, shingles(s, 3));
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best || docText.slice(0, 200);
}
