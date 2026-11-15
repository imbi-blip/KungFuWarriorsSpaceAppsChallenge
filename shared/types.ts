// Types shared by the server and the React client. Type-only: safe to import from both.

export const HORIZON_DAYS = 20;

export type HazardKind = 'wildfire' | 'flood' | 'tsunami';
export type RiskTier = 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Extreme';
export type Confidence = 'low' | 'medium' | 'high';
export type SourceStatus = 'ok' | 'unavailable' | 'skipped';

export interface DailyRisk {
  date: string; // YYYY-MM-DD (UTC)
  score: number; // 0..100
  low: number; // uncertainty band
  high: number;
}

export interface Driver {
  label: string;
  value: string;
  source: string;
}

export interface QuakeBrief {
  id: string;
  mag: number;
  place: string;
  time: string; // ISO
  depthKm: number;
  distanceKm: number;
  tsunamiFlag: boolean;
  url: string | null;
}

export interface TsunamiDetail {
  exposure: number; // 0..1 elevation/coastal exposure proxy
  elevationM: number | null;
  prob20d: number; // chance of an M7+ quake within 1000 km during the horizon (0..1)
  backgroundProb20d: number;
  sequenceProb20d: number;
  recentQuakes: QuakeBrief[];
  officialAlertHint: boolean;
}

export interface HazardAssessment {
  hazard: HazardKind;
  available: boolean;
  unavailableReason?: string;
  tier: RiskTier;
  peakScore: number;
  peakDate: string;
  todayScore: number;
  confidence: Confidence;
  summary: string;
  daily: DailyRisk[];
  drivers: Driver[];
  caveats: string[];
  tsunami?: TsunamiDetail;
}

export interface NearbyEvent {
  id: string;
  title: string;
  category: string;
  lat: number;
  lon: number;
  date: string;
  distanceKm: number;
  url: string | null;
}

export interface LiveEvent {
  id: string;
  title: string;
  category: string;
  lat: number;
  lon: number;
  date: string;
}

export interface LocationInfo {
  lat: number;
  lon: number;
  countryCode: string | null;
  country: string | null;
  place: string | null;
  onLand: boolean | null;
}

export interface EmergencyNumber {
  label: string;
  number: string;
}

export interface Agency {
  name: string;
  url: string;
  role: string;
}

export interface SafetyInfo {
  countryMatched: boolean;
  countryName: string | null;
  emergencyNumbers: EmergencyNumber[];
  agencies: Agency[];
  generalNote: string;
  lastReviewed: string;
}

export interface HazardGuidance {
  hazard: HazardKind;
  headline: string;
  now: string[];
  during: string[];
  after: string[];
  sources: Array<{ name: string; url: string }>;
}

export interface DataSource {
  name: string;
  provider: string;
  nasa: boolean;
  status: SourceStatus;
  note?: string;
}

export interface RiskReport {
  generatedAt: string;
  horizonDays: number;
  location: LocationInfo;
  overallTier: RiskTier;
  hazards: HazardAssessment[];
  nearbyEvents: NearbyEvent[];
  safety: SafetyInfo;
  guidance: HazardGuidance[];
  dataSources: DataSource[];
  briefing: { text: string; source: 'rules' | 'ai' };
  aiAvailable: boolean;
  disclaimer: string;
}
