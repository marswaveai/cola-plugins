export type SynthesizeOpts = {
  baseUrl: string;
  accessToken: string;
  speakerId: string;
  language: "zh" | "en" | "ja" | "ko" | "auto";
  text: string;
  signal?: AbortSignal;
};

const CLIENT_ID = "PJBkELS1o_q9nJ~NzF2_Fmr21TNX&~eoJR49FFdFhD3U";

export async function synthesize(opts: SynthesizeOpts): Promise<Buffer> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/tts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
      "x-marswave-client-id": CLIENT_ID,
    },
    body: JSON.stringify({
      input: opts.text,
      voice: opts.speakerId,
      language: opts.language === "auto" ? "zh" : opts.language,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS synthesis failed: ${res.status} ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
