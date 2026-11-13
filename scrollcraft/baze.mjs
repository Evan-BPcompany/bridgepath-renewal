#!/usr/bin/env node
/**
 * Image and video generation through the BAZE API Gateway (the key of this project is a BAZE key, not a kie.ai one).
 * Docs: https://docs.factchat.kr/docs/general/api-gateway/reference/image-generation
 *       https://docs.factchat.kr/docs/general/api-gateway/reference/video-generation
 *
 *   credits                                        remaining credits (free)
 *   estimate image <model> [--n 1] [--ar 16:9]     quote before spending (free)
 *   estimate video <model> [--dur 5] [--res 720p]  quote before spending (free)
 *   still "<prompt>" <out.png> [--model M] [--ar 16:9] [--ref a.png] [--max 40]
 *   still <out.png> --art <scene> [...]            preamble + scene from art-direction.json (the home page's shared look)
 *   shot  "<prompt>" <image-url> <out.mp4> [--model M] [--dur 5] [--res 720p] [--ar 16:9] [--max 120]
 *
 * Every spend is quoted first; a call above --max credits is refused. The key is read from BAZE_API_KEY, or from the
 * nearest .env walking up from the cwd. It is sent to api.baze.co only and never printed.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://api.baze.co/v1/gateway';
const UA = 'scrollcraft-baze/0.1';

function findKey() {
  if (process.env.BAZE_API_KEY) return process.env.BAZE_API_KEY;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, '.env');
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/^\s*BAZE_API_KEY\s*=\s*(\S+)/m);
      if (m) return m[1];
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('BAZE_API_KEY not set and no .env with it found');
}

const KEY = findKey();
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'User-Agent': UA };

async function call(method, url, body, timeoutMs = 180000) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`${method} ${url.replace(BASE, '')} -> ${r.status}: ${text.slice(0, 400)}`);
  return json ?? text;
}

function args(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]);
  }
  return { pos, opt };
}

function save(out, buf) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('saved', out, `${Math.round(buf.length / 1024)}KB`);
}

async function download(url) {
  if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function imageBody(model, prompt, o) {
  const b = { model, number_of_images: Number(o.n || 1) };
  if (prompt) b.prompt = prompt;
  if (o.ar) {
    // fal-hosted models ignore aspect_ratio (the first probe came back 1:1) and want their own size names
    const fal = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '1:1': 'square_hd' };
    if (model.startsWith('fal-ai/') && fal[o.ar]) b.image_size = fal[o.ar];
    else b.aspect_ratio = o.ar;
  }
  return b;
}

function videoParams(o) {
  const p = {};
  if (o.dur) p.duration = Number(o.dur);
  if (o.res) p.resolution = o.res;
  if (o.ar) p.aspect_ratio = o.ar;
  return p;
}

async function quote(kind, body) {
  const q = await call('POST', `${BASE}/estimate/`, { kind, ...body, prompt: undefined });
  return q;
}

const { pos, opt } = args(process.argv.slice(3));
const cmd = process.argv[2];

if (cmd === 'credits') {
  const j = await call('GET', `${BASE}/credits/`);
  console.log(JSON.stringify({ total_remaining: j.total?.remaining, monthly: j.monthly_allocated?.remaining, purchased: j.purchased?.remaining, org_granted: j.org_granted?.remaining }, null, 1));
} else if (cmd === 'estimate') {
  const [kind, model] = pos;
  const body = kind === 'video' ? { model, parameters: videoParams(opt) } : imageBody(model, null, opt);
  const q = await quote(kind, body);
  console.log(`${kind} ${model}: ${q.credits} credits (${q.bound})`);
} else if (cmd === 'still') {
  // with --art <scene> the prompt is the shared preamble plus that scene of art-direction.json, and the only argument is the output file
  let prompt = pos[0];
  let out = pos[1];
  if (opt.art) {
    const ad = JSON.parse(fs.readFileSync(new URL('./art-direction.json', import.meta.url), 'utf8'));
    if (!ad.scenes[opt.art]) throw new Error(`no scene "${opt.art}" in art-direction.json`);
    prompt = `${ad.preamble}\n\n${ad.scenes[opt.art]}`;
    out = pos[0];
  }
  const model = opt.model || 'bytedance/seedream-5-pro';
  const body = imageBody(model, prompt, opt);
  if (opt.ref) body.input_images = [`data:image/png;base64,${fs.readFileSync(opt.ref).toString('base64')}`];
  const q = await quote('image', body);
  console.log(`quote ${q.credits} credits (${q.bound})`);
  if (q.credits > Number(opt.max || 40)) throw new Error(`refused: ${q.credits} is above --max ${opt.max || 40}`);
  const j = await call('POST', `${BASE}/images/generate/`, body, 240000);
  let item = j.data?.[0];
  if (!item && j.operation_id) {
    for (let i = 0; i < 40 && !item; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      const s = await call('GET', `${BASE}/images/generate/${j.operation_id}/?model=${encodeURIComponent(model)}`);
      if (s.status === 'failed') throw new Error('image job failed');
      item = s.data?.[0];
    }
  }
  if (!item) throw new Error('no image returned');
  save(out, await download(item.url));
  console.log('credits charged:', j.credits_charged, '| url:', item.url.startsWith('data:') ? '(inline)' : item.url);
} else if (cmd === 'shot') {
  const [prompt, imageUrl, out] = pos;
  const model = opt.model || 'bytedance/seedance-2.0/fast';
  const body = { model, prompt, parameters: videoParams(opt) };
  if (imageUrl && imageUrl !== 'none') body.input_urls = [imageUrl];
  const q = await quote('video', { model, parameters: body.parameters });
  console.log(`quote ${q.credits} credits (${q.bound})`);
  if (q.credits > Number(opt.max || 120)) throw new Error(`refused: ${q.credits} is above --max ${opt.max || 120}`);
  const sub = await call('POST', `${BASE}/video/generation/`, body);
  console.log('submitted', sub.operation_id, '| charged', sub.credits_charged);
  let status = sub.status;
  let s = sub;
  for (let i = 0; i < 60 && status !== 'completed' && status !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    s = await call('GET', `${BASE}/video/generation/${sub.operation_id}/?model=${encodeURIComponent(model)}`);
    status = s.status;
    process.stdout.write('.');
  }
  console.log('\nstatus', status);
  if (status !== 'completed') throw new Error('video failed or timed out; credits are refunded for failed jobs when checked within 7 days');
  const uri = s.video_uri || '';
  const buf = uri.startsWith('http')
    ? await download(uri)
    : Buffer.from(await (await fetch(`${BASE}/video/generation/${sub.operation_id}/download/?model=${encodeURIComponent(model)}`, { headers: H })).arrayBuffer());
  save(out, buf);
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 14).join('\n'));
}
