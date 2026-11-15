import type { HazardGuidance, HazardKind, RiskTier } from '../../shared/types.ts';
import { tierRank } from '../risk/util.ts';

const SOURCES: Record<HazardKind, Array<{ name: string; url: string }>> = {
  wildfire: [
    { name: 'NASA FIRMS Fire Map', url: 'https://firms.modaps.eosdis.nasa.gov/map/' },
    { name: 'Ready.gov - Wildfires', url: 'https://www.ready.gov/wildfires' },
    { name: 'WHO - Wildfire smoke and health', url: 'https://www.who.int/health-topics/air-pollution' },
  ],
  flood: [
    { name: 'GDACS - Global alerts', url: 'https://www.gdacs.org' },
    { name: 'Ready.gov - Floods', url: 'https://www.ready.gov/floods' },
    { name: 'NASA Disasters Program', url: 'https://appliedsciences.nasa.gov/what-we-do/disasters' },
  ],
  tsunami: [
    { name: 'Pacific Tsunami Warning Center', url: 'https://www.tsunami.gov' },
    { name: 'UNESCO-IOC Tsunami Ready', url: 'https://tsunamiready.ioc.unesco.org' },
    { name: 'Ready.gov - Tsunamis', url: 'https://www.ready.gov/tsunamis' },
  ],
};

const CONTENT: Record<HazardKind, { headline: string; now: string[]; during: string[]; after: string[] }> = {
  wildfire: {
    headline: 'Wildfire safety',
    now: [
      'Know two evacuation routes from home and work; agree on a meeting point with your household.',
      'Pack a go-bag: ID, medicines, phone charger, water, N95/FFP2 masks, spare clothes, pet supplies.',
      'Sign up for local emergency alerts and check them daily while danger is high.',
      'Clear dry leaves and debris from gutters and around buildings; keep flammables away from walls.',
      'Never leave campfires, grills or machinery unattended in dry, windy weather.',
    ],
    during: [
      'Leave EARLY when told to evacuate - do not wait to see flames. Follow official routes.',
      'If trapped in a car: park away from vegetation, close windows and vents, get below window level, cover with a wool blanket or jacket.',
      'Wear a fitted N95/FFP2 mask against smoke, wear long cotton or wool clothing and sturdy shoes.',
      'Keep windows and doors closed; run air filtration or recirculate air if you must shelter.',
    ],
    after: [
      'Return only when authorities say it is safe; watch for hot spots, falling trees and damaged power lines.',
      'Wear a mask and gloves when cleaning ash. Check food and water safety.',
      'Report any flare-ups to emergency services immediately.',
    ],
  },
  flood: {
    headline: 'Flood safety',
    now: [
      'Check whether your home or route is in a flood-prone area; keep documents and medicines in a waterproof bag.',
      'Move valuables and electricals upstairs; know where to shut off power, gas and water.',
      'Identify higher ground and a route to it that avoids low bridges and underpasses.',
      'Sign up for local flood warnings; monitor river and rainfall alerts when heavy rain is forecast.',
    ],
    during: [
      'Move to higher ground immediately if told to evacuate or if water is rising. Do not wait.',
      'Never walk, swim or drive through floodwater - about 15 cm (6 in) of moving water can knock you down and 30 cm (12 in) can float a car. Turn around, don\'t drown.',
      'Stay away from downed power lines and keep out of basements and low rooms.',
      'If trapped in a building, go to the highest floor (not a closed attic) and signal for help.',
    ],
    after: [
      'Floodwater can be contaminated and electrically charged: avoid contact and disinfect anything it touched.',
      'Do not return until authorities say it is safe; have wiring and gas checked before using them.',
      'Photograph damage for insurance; watch for landslides and weakened structures.',
    ],
  },
  tsunami: {
    headline: 'Tsunami safety',
    now: [
      'If you live, work or travel on a coast, find out if you are inside a tsunami hazard zone and where the nearest high ground or vertical-evacuation building is.',
      'Learn the natural warnings: strong or long earthquake shaking, a loud ocean roar, or the sea suddenly receding.',
      'Practise your evacuation route on foot; keep a go-bag by the door.',
      'Register for national tsunami and earthquake alerts.',
    ],
    during: [
      'If you feel strong or prolonged shaking near the coast: drop, cover and hold on, then move immediately to high ground or inland. Do not wait for an official warning.',
      'Go as high and as far inland as you can (aim for at least 30 m / 100 ft above sea level or about 3 km / 2 mi inland where possible), on foot if roads are jammed.',
      'Stay away from the beach and harbours; never go to watch the waves. Tsunamis are a series of waves and the first is rarely the largest.',
      'Stay out of the danger zone until officials declare it safe - this can take many hours.',
    ],
    after: [
      'Expect aftershocks and further waves; listen to official radio or alerts.',
      'Avoid flooded areas and debris; watch for damaged buildings and gas leaks.',
      'Help others only when it is safe; call emergency services for injuries.',
    ],
  },
};

const ESCALATION: Array<{ min: number; line: string }> = [
  { min: 4, line: 'Risk is EXTREME: follow official instructions, consider relocating vulnerable people early, and keep your phone charged with alerts on.' },
  { min: 3, line: 'Risk is HIGH: finish preparations now, check official alerts at least daily, and be ready to leave on short notice.' },
  { min: 2, line: 'Risk is ELEVATED: prepare your go-bag, confirm your evacuation route and sign up for alerts.' },
];

export function getGuidance(hazard: HazardKind, tier: RiskTier): HazardGuidance {
  const c = CONTENT[hazard];
  const esc = ESCALATION.find((e) => tierRank(tier) >= e.min);
  return {
    hazard,
    headline: c.headline,
    now: esc ? [esc.line, ...c.now] : c.now,
    during: c.during,
    after: c.after,
    sources: SOURCES[hazard],
  };
}
