export type TrackId = 'wildfires' | 'co2' | 'sst' | 'aerosols';

export type SynthMode = 'pad' | 'chimes' | 'pulse';

export interface LegendStop {
  color: string;
  label: string;
  value: string;
}

export interface EarthTrack {
  id: TrackId;
  index: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  mission: string;
  sensor: string;
  cadence: string;
  spatialRes: string;
  unit: string;
  description: string;
  legendExplanation: string;
  gradientCss: string;
  legendStops: LegendStop[];
  defaultSynthMode: SynthMode;
  defaultMinFreq: number;
  defaultMaxFreq: number;
  scaleType: 'minorPentatonic' | 'lydian' | 'majorPentatonic' | 'suspended';
  durationSeconds: number;
}

export const EARTH_TRACKS: EarthTrack[] = [
  {
    id: 'wildfires',
    index: 1,
    title: 'Global Wildland Fires & Thermal Anomalies',
    shortTitle: 'Wildland Fires',
    subtitle: 'Active fire radiative power & surface thermal hotspots',
    mission: 'NASA Suomi NPP / NOAA-20 / Terra',
    sensor: 'VIIRS 375m & MODIS Thermal',
    cadence: 'Daily Global Composite · 30s Loop',
    spatialRes: '375 m nadir',
    unit: 'K (Brightness Temp)',
    description:
      'Tracks active fire fronts, boreal peatland combustion, and seasonal savanna burning using infrared radiative signatures across major continental basins.',
    legendExplanation:
      'Deep basalt marks cool background terrain; amber and crimson peaks highlight high-intensity active combustion fronts (>480 K).',
    gradientCss:
      'linear-gradient(90deg, #111827 0%, #450a0a 28%, #b91c1c 56%, #f97316 80%, #fef08a 100%)',
    legendStops: [
      { color: '#111827', label: 'Ambient', value: '295 K' },
      { color: '#b91c1c', label: 'Moderate', value: '390 K' },
      { color: '#f97316', label: 'Intense', value: '475 K' },
      { color: '#fef08a', label: 'Extreme FRP', value: '550+ K' },
    ],
    defaultSynthMode: 'chimes',
    defaultMinFreq: 196,
    defaultMaxFreq: 880,
    scaleType: 'minorPentatonic',
    durationSeconds: 30,
  },
  {
    id: 'co2',
    index: 2,
    title: 'Atmospheric CO₂ & Greenhouse Gas Flows',
    shortTitle: 'Atmospheric CO₂',
    subtitle: 'Column-averaged dry-air mole fraction & Rossby advection',
    mission: 'NASA OCO-2 / GEOS-5 Assimilation',
    sensor: 'Orbiting Carbon Observatory Spectrometer',
    cadence: '6-Hour Synoptic Flow · 30s Loop',
    spatialRes: '0.5° × 0.625° grid',
    unit: 'ppm (CO₂)',
    description:
      'Visualizes swirling mid-latitude jet-stream plumes transporting industrial and seasonal biospheric carbon dioxide across northern and southern hemispheres.',
    legendExplanation:
      'Deep indigo indicates lower carbon sinks; teal, warm amber, and bright magenta-white ribbons reveal dense advecting CO₂ plumes (>435 ppm).',
    gradientCss:
      'linear-gradient(90deg, #0f172a 0%, #1d4ed8 25%, #06b6d4 52%, #f59e0b 78%, #fdf4ff 100%)',
    legendStops: [
      { color: '#1d4ed8', label: 'Sink', value: '410 ppm' },
      { color: '#06b6d4', label: 'Mean', value: '422 ppm' },
      { color: '#f59e0b', label: 'Elevated', value: '434 ppm' },
      { color: '#fdf4ff', label: 'Dense Core', value: '446+ ppm' },
    ],
    defaultSynthMode: 'pad',
    defaultMinFreq: 146.83,
    defaultMaxFreq: 587.33,
    scaleType: 'lydian',
    durationSeconds: 30,
  },
  {
    id: 'sst',
    index: 3,
    title: 'Sea Surface Temperature Anomalies',
    shortTitle: 'Ocean Thermal Shifts',
    subtitle: 'Multi-scale departure from 1991–2020 climatology',
    mission: 'NASA Aqua / GHRSST MUR',
    sensor: 'AMSR2 & MODIS Infrared',
    cadence: 'Monthly Anomaly · 30s Loop',
    spatialRes: '1 km global ocean',
    unit: '°C (Anomaly ΔT)',
    description:
      'Captures equatorial Pacific El Niño warming tongues, western boundary current heatwaves, and high-latitude upwelling cooling anomalies.',
    legendExplanation:
      'Cobalt and ice-cyan map cooler upwelling currents (-3.0 °C); neutral slate marks climatological normal; amber-red highlights marine heatwaves (+4.0 °C).',
    gradientCss:
      'linear-gradient(90deg, #1e3a8a 0%, #0284c7 26%, #334155 50%, #ea580c 76%, #dc2626 100%)',
    legendStops: [
      { color: '#1e3a8a', label: 'Upwelling', value: '-3.0 °C' },
      { color: '#334155', label: 'Baseline', value: '0.0 °C' },
      { color: '#ea580c', label: 'Warming', value: '+2.0 °C' },
      { color: '#dc2626', label: 'Heatwave', value: '+4.0 °C' },
    ],
    defaultSynthMode: 'pad',
    defaultMinFreq: 130.81,
    defaultMaxFreq: 523.25,
    scaleType: 'majorPentatonic',
    durationSeconds: 30,
  },
  {
    id: 'aerosols',
    index: 4,
    title: 'Global Aerosol & Air Quality Index',
    shortTitle: 'Aerosols & AQI',
    subtitle: 'Saharan dust transport, sulfate haze & optical depth',
    mission: 'NASA Terra / GEOS-FP / PACE',
    sensor: 'MISR & MODIS Aerosol Depth',
    cadence: 'Synoptic Waves · 30s Loop',
    spatialRes: '10 km aerosol grid',
    unit: 'AOD (550 nm)',
    description:
      'Models trans-Atlantic Saharan mineral dust rivers, East Asian industrial sulfate plumes, and biomass smoke aerosols suspended in the troposphere.',
    legendExplanation:
      'Charcoal-violet marks clean maritime air (AOD < 0.1); ochre and copper denote mineral dust; intense coral-white signals hazardous particulate density (AOD > 1.5).',
    gradientCss:
      'linear-gradient(90deg, #090d16 0%, #312e81 26%, #a16207 54%, #ea580c 80%, #fed7aa 100%)',
    legendStops: [
      { color: '#312e81', label: 'Clean Air', value: '0.05 AOD' },
      { color: '#a16207', label: 'Dust Haze', value: '0.55 AOD' },
      { color: '#ea580c', label: 'Unhealthy', value: '1.10 AOD' },
      { color: '#fed7aa', label: 'Severe', value: '1.80+ AOD' },
    ],
    defaultSynthMode: 'pulse',
    defaultMinFreq: 164.81,
    defaultMaxFreq: 783.99,
    scaleType: 'suspended',
    durationSeconds: 30,
  },
];
