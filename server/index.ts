import { createServer } from 'node:http';
import { createGeminiClient } from './agent/llm.ts';
import { createApp } from './app.ts';
import { RiskService } from './assess.ts';
import { describeConfig, loadConfig, loadEnvFiles } from './config.ts';
import { UpstreamClient, UPSTREAM_HOSTS } from './net/upstream.ts';
import { GeocodeProvider } from './providers/geocode.ts';
import { NasaEonetProvider } from './providers/nasaEonet.ts';
import { NasaFirmsProvider } from './providers/nasaFirms.ts';
import { NasaPowerProvider } from './providers/nasaPower.ts';
import { OpenMeteoProvider } from './providers/openMeteo.ts';
import { UsgsProvider } from './providers/usgs.ts';

loadEnvFiles();
const config = loadConfig();

const ua = `EarthJukebox/1.0 (+risk-outlook${config.contactEmail ? `; ${config.contactEmail}` : ''})`;
const upstream = new UpstreamClient({ allowedHosts: [...UPSTREAM_HOSTS, new URL(config.geocoderUrl).hostname], userAgent: ua });
const risk = new RiskService({
  power: new NasaPowerProvider(upstream),
  eonet: new NasaEonetProvider(upstream),
  firms: config.firmsMapKey ? new NasaFirmsProvider(upstream, config.firmsMapKey) : null,
  usgs: new UsgsProvider(upstream),
  meteo: config.enableOpenMeteo ? new OpenMeteoProvider(upstream) : null,
  geocoder: new GeocodeProvider(upstream, config.geocoderUrl),
});
const llm = config.geminiApiKey ? createGeminiClient(config.geminiApiKey, config.geminiModel) : null;

let devMiddleware: Parameters<typeof createApp>[0]['devMiddleware'];
if (!config.isProd) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ server: { middlewareMode: true }, appType: 'spa' });
  devMiddleware = vite.middlewares as unknown as typeof devMiddleware;
}

const server = createServer(
  { maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 },
  createApp({ config, risk, llm, devMiddleware, log: (l) => console.log(l) }),
);
server.maxRequestsPerSocket = 200;
server.listen(config.port, config.host, () => {
  console.log('The Earth Jukebox listening', JSON.stringify(describeConfig(config)));
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e instanceof Error ? e.name : typeof e));
