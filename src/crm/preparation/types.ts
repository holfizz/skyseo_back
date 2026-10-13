export type PreparationPhase = 'SITE' | 'KEYWORDS' | 'POSITIONS' | 'COMPETITORS' | 'DOCUMENTS'
export type PageEvidence = {
 url: string; title: string; headings: string[]; text: string; links: Array<{text: string; url: string; navigation?: boolean}>;
 contentText?: string;
 capturedAt: string; image?: string; logo?: string; error?: string
}
export type SearchEvidence = {
 keyword: string; group: string; clientEvidenceUrl: string; position: number | null; url: string | null;
 scanned: number; top10: Array<{position: number; domain: string; url: string}>; measuredAt?: string;
 source?: string; error?: string; volume: number | null; volumeAt?: string; volumeRegion?: number; volumePeriod?: string; wordstatSeedCompleted?:boolean
}
export type ComparisonEvidence = {
 id: string; keyword: string; clientUrl: string; clientPosition: number | null; scanned: number;
 competitor: {domain: string; url: string; position: number}; clientFinding: string; competitorFinding: string;
 apply: string; benefit: string; capturedAt: string; image: string; clientImage?: string; feature: string
}
export type Research = {
 version: 1; domain: string; siteUrl?: string; maxKeywords?: number; companyName: string; region: {name: string; lr: number; assumed: boolean};
 sitePages: PageEvidence[]; keywords: SearchEvidence[]; comparisons: ComparisonEvidence[];
 issues: Array<{phase: PreparationPhase; message: string}>; completed: PreparationPhase[];
 trial: 'CONFIRMED' | 'UNCONFIRMED' | 'UNAVAILABLE'; createdAt: string
}
export type DeckSlide = {id: string; kind: 'COVER' | 'POSITIONS' | 'COMPARISON' | 'POTENTIAL' | 'CASE' | 'ADVANTAGES' | 'PORTFOLIO' | 'NEXT' | 'KEYWORDS'; title: string; comparisonId?: string; keywordOffset?: number}
export const PHASES: PreparationPhase[] = ['SITE','KEYWORDS','POSITIONS','COMPETITORS','DOCUMENTS']
