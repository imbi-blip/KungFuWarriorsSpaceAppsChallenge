# Methodology and limits

All three hazards produce a daily score for today + 19 days (UTC), an uncertainty band that widens as forecast
skill falls, the drivers behind the number, and explicit caveats. The tier is set from the **highest daily score**
in the window (precautionary): Low <20, Moderate 20-39, Elevated 40-59, High 60-79, Extreme >=80.

## Weather timeline (`server/risk/weather.ts`)
* Days 0-15: Open-Meteo numerical forecast (temperature max, mean RH from hourly, wind, precipitation). Skill falls
  linearly from 1.0 to 0.45 with lead time.
* Days 16-19 (or all days if the forecast is unavailable/disabled): NASA POWER 1991-2020 monthly climatology plus the
  recent 10-day observed anomaly decaying with an e-folding time of 10 days. Skill 0.25.
* No 20-day deterministic weather forecast exists. Beyond ~10 days the outlook is background risk, and the UI says so.

## Wildfire (`wildfire.ts`) - danger index, not a probability
`score = 100 * (0.45*weather + 0.35*dryness + 0.20*ignition) * (0.35 + 0.65*fuel)`
* weather = 0.40 dry-air + 0.35 heat + 0.25 wind, each clamped to 0-1 (RH 65->20 %, Tmax 15->40 degC, wind 0->12 m/s); damped x0.5 / x0.25 on days with >=5 / >=10 mm rain.
* dryness starts from NASA POWER soil wetness (surface+root zone) and 30-day rainfall deficit vs climatology, then dries with heat and wets with forecast rain.
* ignition from NASA FIRMS VIIRS detections within 50 km in 3 days (log scale) and NASA EONET open wildfire events; decays with e-folding 10 days.
* fuel = clamp((annual rainfall - 100 mm)/400): arid terrain cannot sustain large fires. **No land-cover/NDVI is used.**

## Flood (`flood.ts`) - potential index
* rainTerm = max(3-day rain / H3, 1-day rain / 0.7 H3), H3 = clamp(25 + 6 x climatological mm/day, 30, 110) mm.
* amplified by soil saturation (0.65 + 0.7 x wetness), which evolves with rain.
* river term from Open-Meteo/GloFAS discharge relative to its 30-day median (1.5x -> 0, 5.5x -> 1).
* open NASA EONET flood within 100 / 300 km adds a decaying floor. Combined as noisy-OR.
* Not modelled: terrain/drainage, dams and levees, snowmelt, coastal surge.

## Tsunami (`tsunami.ts`) - trigger probability x exposure
Tsunamis cannot be forecast days ahead; what can be estimated is the chance of the large earthquake that causes one.
* Background: USGS count of M>=7 within 1000 km since 1990 -> Poisson rate.
* Sequence: each M>=6, depth<=100 km quake in the last 30 days within 1500 km contributes Reasenberg-Jones (1989)
  generic aftershock expectation for M>=7 per day, weighted by exp(-distance/600 km). This is what makes the risk "shift" and decay.
* score = 100 x exposure x log-scaled(20-day probability): 0.2 % -> 0, 15 % -> 100.
* exposure from elevation (<=10 m 1.0 ... >120 m 0.05; offshore 0.6). It is a proxy: **use official hazard-zone maps.**
* A recent (<24 h) M>=7 shallow quake within 600 km, or a USGS tsunami flag on an M>=6.5 within 3 days, sets "official alert hint": UI shows an alert and the tier is at least High.
* Not modelled: landslide/volcanic tsunamis, far-field propagation, coastal geometry.

## What a user should take from it
Relative ranking and trend over 20 days, plus the reasons. Not an evacuation trigger: follow local authorities.

## Safety content
Emergency numbers and agency links are a curated static table (`server/safety/emergencyDirectory.ts`), reviewed
manually (`LAST_REVIEWED`), covered by format tests, and shown with a "verify locally" notice. Unmatched countries
get only 112 (GSM) plus global resources. Country detection uses reverse geocoding; if it fails the UI falls back
to the generic block instead of guessing.
