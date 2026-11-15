import type { LlmClient } from './briefing.ts';

/** Lazily loads @google/genai so the server (and tests) run without it when no key is configured. */
export function createGeminiClient(apiKey: string, model: string): LlmClient {
  let clientPromise: Promise<{ ai: any; ThinkingLevel: any }> | null = null;
  const get = () =>
    (clientPromise ??= import('@google/genai').then((m) => ({
      ai: new m.GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } }),
      ThinkingLevel: m.ThinkingLevel,
    })));
  return {
    async generateText({ system, prompt, image, maxMs = 20_000 }) {
      const { ai, ThinkingLevel } = await get();
      const parts: unknown[] = [];
      if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
      parts.push({ text: prompt });
      const call = ai.models.generateContent({
        model,
        contents: { parts },
        config: { systemInstruction: system, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('llm timeout')), maxMs);
      });
      try {
        const res = (await Promise.race([call, timeout])) as { text?: string };
        return (res.text ?? '').trim();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
