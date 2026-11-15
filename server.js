const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Cosme)' };
const ESPN = 'https://site.api.espn.com/apis';
const TEAM_ID = '1929';
const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LOGO_BASE = 'https://a.espncdn.com/i/leaguelogos/soccer/500-dark';
// ESPN has no logo for Taça de Portugal, so it is bundled in public/. Competitions without a logo fall back to their name.
const COMPETITIONS = [
  ['por.1', 'Liga', `${LOGO_BASE}/14.png`],
  ['uefa.europa', 'Liga Europa', `${LOGO_BASE}/2310.png`],
  ['por.taca.portugal', 'Taça de Portugal', '/taca-portugal.png'],
];
const STANDINGS_LEAGUES = ['por.1', 'uefa.europa'];

const PODCASTS = [
  { show: 'Falar Benfica', feed: 'https://anchor.fm/s/6c1148e4/podcast/rss' },
  { show: 'Canto do Benfica', feed: 'https://feeds.ivoox.com/feed_fg_f12830527_filtro_1.xml' },
];

const EVENT_KINDS = {
  goal: 'goal', 'goal---header': 'goal', 'goal---free-kick': 'goal', 'penalty---scored': 'goal', 'own-goal': 'goal',
  'yellow-card': 'yellow', 'red-card': 'red', substitution: 'sub',
};
const MATCH_STATS = ['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'passPct', 'offsides'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v;
    throw e;
  }
}

async function get(url, charset = 'utf-8') {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return new TextDecoder(charset).decode(await r.arrayBuffer());
}

const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[|\]\]>|&lt;!\[CDATA\[|\]\]&gt;/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/\s+/g, ' ').trim();

// Text content of the first <name> element in an XML snippet.
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

const meta = (html, prop) => {
  const re1 = new RegExp(`(?:property|name)=["']${prop}["']\\s+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`content=["']([^"']*)["']\\s+(?:property|name)=["']${prop}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? decode(m[1]) : '';
};

const NON_FOOTBALL = /basquet|andebol|futsal|voleibol|h[óo]quei|atletismo|t[ée]nis|motor|ciclismo|nata[çc][ãa]o|râguebi|rugby|modalidades|f[óo]rmula|\bnba\b|\bnfl\b|padel|surf|golfe|boxe|\bmma\b|ufc|e-?sports/i;
const isFootball = (...parts) => !NON_FOOTBALL.test(parts.join(' '));

const TITLE_SUFFIX = /\s*[|–-]\s*(O Jogo|Record|A Bola)$/i;
const xmlItems = (xml) => xml.split('<item>').slice(1);
const isoDate = (v) => new Date(v).toISOString();
const mergeByUrl = (entries) => {
  const map = new Map();
  entries.forEach((e) => map.set(e.url, { ...map.get(e.url), ...e }));
  return [...map.values()];
};
const isDefaultImg = (u) => !u || /default|logo|placeholder/i.test(u);

// Only direct media files play in-site; other contentUrl values (e.g. A Bola's logo) are ignored.
const playableUrl = (u = '') => {
  const url = u.replace(/\\\//g, '/');
  return /videoredirect|\.mp4|\.m3u8/i.test(url) ? url : '';
};

async function pageInfo(url) {
  return cached('page:' + url, 6 * HOUR, async () => {
    const html = await get(url);
    return {
      title: meta(html, 'og:title'),
      image: meta(html, 'og:image'),
      description: meta(html, 'og:description'),
      date: meta(html, 'article:published_time') || meta(html, 'og:updated_time'),
      section: meta(html, 'article:section'),
      paid: /isAccessibleForFree"?\s*:\s*"?false|premium-paywall|photo--paywall/i.test(html),
      video: playableUrl((html.match(/"contentUrl"\s*:\s*"(https:[^"]+)"/) || [])[1]),
    };
  });
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]).catch(() => null);
      }
    })
  );
  return out;
}

const ABOUT_BENFICA = /benfica|\bslb\b|rui[ -]costa|encarnad|estádio da luz|estadio-da-luz/i;
const NOT_MAIN_TEAM = /feminin|jogadora|benfica-b\b|juniores|\bsub-?\d\d|ex-benfica|antigo (jogador|guarda-redes|avançado|médio|defesa) do benfica/i;
const BENFICA_RE = /benfica|\bslb\b|rui-costa|rui costa/i;

async function enrich(entries, source) {
  const rows = await pool(entries, 8, async (e) => {
    const info = await pageInfo(e.url);
    if (info.paid) return null;
    if (!isFootball(info.section, info.title, e.url)) return null;
    const text = `${info.title} ${info.description} ${e.title || ''} ${e.description || ''} ${e.url}`;
    if (!ABOUT_BENFICA.test(text) || NOT_MAIN_TEAM.test(text)) return null;
    return {
      source,
      title: info.title.replace(TITLE_SUFFIX, '') || e.title,
      description: info.description || e.description || '',
      url: e.url,
      image: isDefaultImg(info.image) ? e.image || '' : info.image,
      date: info.date ? isoDate(info.date) : e.date || '',
    };
  });
  return rows.filter((r) => r && r.title);
}

async function links(url, re, base) {
  const html = await get(url).catch(() => '');
  return (html.match(re) || []).map((h) => (h.startsWith('http') ? h : base + h));
}

async function fromRecord() {
  const base = 'https://www.record.pt';
  const [xml, listing] = await Promise.all([
    get(base + '/rss', 'iso-8859-1'),
    get(base + '/futebol/futebol-nacional/liga-betclic/benfica').catch(() => ''),
  ]);
  const fromRss = xmlItems(xml).map((it) => {
    const enc = it.match(/<enclosure[^>]*url="([^"]+)"/);
    return {
      title: tag(it, 'title'), description: tag(it, 'description'), url: tag(it, 'link'),
      image: enc ? enc[1] : '', date: isoDate(tag(it, 'pubDate').replace(/ Z$/, ' GMT')),
      cat: tag(it, 'category'),
    };
  }).filter((i) => /benfica/i.test(i.url + i.cat + i.title + i.description));
  const fromList = (listing.match(/href="\/[^"]*\/detalhe\/[^"]*ref=Benfica_[^"]*"/g) || [])
    .map((h) => ({ url: base + h.slice(6, -1).replace(/\?ref=.*$/, '') }));
  const entries = mergeByUrl([...fromList, ...fromRss]).filter((e) => /\/futebol\//i.test(e.url) && !/\/videos?\//i.test(e.url));
  return enrich(entries, 'Record');
}

async function fromABola() {
  const re = /https:\/\/www\.abola\.pt\/noticias\/[a-z0-9-]+/g;
  const pages = await Promise.all([1, 2, 3, 4].map((n) => links(`https://www.abola.pt/futebol/benfica-450?page=${n}`, re, '')));
  const xml = await get('https://www.abola.pt/rss-articles.xml').catch(() => '');
  const rss = xmlItems(xml).map((it) => ({ title: tag(it, 'title'), url: tag(it, 'link'), date: isoDate(tag(it, 'pubDate')) }))
    .filter((i) => BENFICA_RE.test(i.title));
  return enrich(mergeByUrl([...pages.flat().map((url) => ({ url })), ...rss]), 'A Bola');
}

async function fromOJogo() {
  const re = /\/futebol\/artigo\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/\d{6,}/g;
  const base = 'https://www.ojogo.pt';
  const [tagLinks, others] = await Promise.all([
    links(base + '/tag/benfica', re, base),
    Promise.all([base + '/futebol', base + '/'].map((u) => links(u, re, base))),
  ]);
  const extra = others.flat().filter((u) => BENFICA_RE.test(u));
  return enrich([...new Set([...tagLinks, ...extra])].map((url) => ({ url })), 'O Jogo');
}

async function enrichVideos(urls, source) {
  const rows = await pool(urls, 8, async (url) => {
    const info = await pageInfo(url);
    if (info.paid) return null;
    const text = `${info.title} ${info.description} ${url}`;
    if (!ABOUT_BENFICA.test(text) || NOT_MAIN_TEAM.test(text) || !isFootball(info.section, info.title, url)) return null;
    return {
      source,
      title: info.title.replace(TITLE_SUFFIX, ''),
      description: info.description || '',
      url,
      video: info.video,
      image: isDefaultImg(info.image) ? '' : info.image,
      date: info.date ? isoDate(info.date) : '',
    };
  });
  return rows.filter((r) => r && r.title);
}

const OPINION_RE = /an[áa]lise|opini[ãa]o|coment|debate|cr[óo]nica|ponto de situa|o que se passa|pontos? chave|bastidores|conversa/i;
const ABOLA_SHOWS = ['90-mais-3', 'toque-de-bola', 'a-bola-tv', 'meio-campo'];

async function podcasts() {
  const lists = await Promise.all(
    PODCASTS.map(async ({ show, feed }) => {
      try {
        const xml = await get(feed);
        const cover = (xml.match(/<itunes:image[^>]*href="([^"]+)"/) || [])[1] || '';
        return xmlItems(xml).slice(0, 8).map((it) => ({
          show,
          title: tag(it, 'title'),
          description: tag(it, 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220),
          audio: (it.match(/<enclosure[^>]*url="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') || '',
          image: (it.match(/<itunes:image[^>]*href="([^"]+)"/) || [])[1] || cover,
          duration: tag(it, 'itunes:duration'),
          url: tag(it, 'link'),
          date: isoDate(tag(it, 'pubDate')),
        }));
      } catch {
        return [];
      }
    })
  );
  return { items: lists.flat().filter((p) => p.audio).sort((a, b) => new Date(b.date) - new Date(a.date)) };
}

async function videos() {
  const rec = 'https://www.record.pt', ab = 'https://www.abola.pt';
  const strip = (u) => u.replace(/\?ref=.*$/, '');
  const abRe = /https:\/\/www\.abola\.pt\/video\/[a-z0-9-]+/g;
  const recRe = /\/multimedia\/videos\/(?:benfica\/)?detalhe\/[a-z0-9-]+/g;
  const jobs = [
    ['A Bola', async () => (await Promise.all(ABOLA_SHOWS.map((sh) => links(`${ab}/${sh}/video`, abRe, '')))).flat(), () => true],
    ['Record', () => links(rec + '/multimedia/videos/benfica', recRe, rec), (v) => OPINION_RE.test(v.title + ' ' + v.description)],
    ['Record', async () => (await Promise.all(['record-na-hora', 'o-record-da-tudo'].map((sh) => links(`${rec}/multimedia/${sh}`, new RegExp(`/multimedia/${sh}/detalhe/[a-z0-9-]+`, 'g'), rec)))).flat(), () => true],
  ];
  const results = await Promise.allSettled(
    jobs.map(async ([source, getLinks, keep]) => (await enrichVideos([...new Set((await getLinks()).map(strip))], source)).filter(keep))
  );
  const seen = new Set();
  const items = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((v) => v.image && Date.now() - new Date(v.date) < 60 * DAY && !seen.has(v.url) && seen.add(v.url))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { updated: new Date().toISOString(), items: items.slice(0, 40) };
}

const IS_VIDEO = /\/videos?\/|\/multimedia\//i;

async function news() {
  const results = await Promise.allSettled([fromRecord(), fromABola(), fromOJogo()]);
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const seen = new Set();
  const list = all
    .filter((n) => n.title && !IS_VIDEO.test(n.url) && !seen.has(n.url) && seen.add(n.url))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { updated: new Date().toISOString(), items: list.slice(0, 80), errors: results.filter((r) => r.status === 'rejected').length };
}

function mapEvent(e) {
  const c = e.competitions[0];
  const home = c.competitors.find((t) => t.homeAway === 'home');
  const away = c.competitors.find((t) => t.homeAway === 'away');
  const t = (x) => ({
    id: x.team.id,
    name: x.team.shortDisplayName || x.team.displayName,
    logo: x.team.logos?.[0]?.href || '',
    score: x.score?.displayValue ?? x.score ?? null,
  });
  return {
    id: e.id,
    date: e.date,
    state: c.status.type.state,
    home: t(home),
    away: t(away),
  };
}

async function matches() {
  const lists = await Promise.all(
    COMPETITIONS.flatMap(([code, label, logo]) =>
      ['', '?fixture=true'].map((q) =>
        fetch(`${ESPN}/site/v2/sports/soccer/${code}/teams/${TEAM_ID}/schedule${q}`, { headers: UA })
          .then((r) => r.json())
          .then((d) => (d.events || []).map((e) => ({ ...mapEvent(e), competition: label, competitionLogo: logo, league: code })))
          .catch(() => [])
      )
    )
  );
  const byId = new Map();
  lists.flat().forEach((m) => byId.set(m.id, m));
  const all = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    results: all.filter((m) => m.state === 'post').reverse(),
    live: all.filter((m) => m.state === 'in'),
    fixtures: all.filter((m) => m.state === 'pre'),
  };
}

async function scorers() {
  const d = await fetch(`${ESPN}/site/v2/sports/soccer/por.1/teams/${TEAM_ID}/roster`, { headers: UA }).then((r) => r.json());
  const stat = (a, name) => {
    for (const c of a.statistics?.splits?.categories || []) {
      const f = c.stats.find((x) => x.name === name);
      if (f) return Number(f.value) || 0;
    }
    return 0;
  };
  const players = (d.athletes || []).map((a) => ({
    name: a.displayName,
    apps: stat(a, 'appearances'),
    goals: stat(a, 'totalGoals'),
    assists: stat(a, 'goalAssists'),
  }));
  const top = (k) => players.filter((p) => p[k] > 0).sort((a, b) => b[k] - a[k] || a.apps - b.apps).slice(0, 5);
  return { scorers: top('goals'), assisters: top('assists') };
}

async function table(league = 'por.1') {
  const d = await fetch(`${ESPN}/v2/sports/soccer/${league}/standings`, { headers: UA }).then((r) => r.json());
  const entries = d.children[0].standings.entries.map((e) => {
    const s = Object.fromEntries(e.stats.map((x) => [x.name, x.displayValue ?? x.value]));
    return {
      id: e.team.id,
      name: e.team.shortDisplayName || e.team.displayName,
      logo: e.team.logos?.[0]?.href || '',
      rank: Number(s.rank),
      played: s.gamesPlayed,
      wins: s.wins,
      draws: s.ties,
      losses: s.losses,
      gd: s.pointDifferential,
      points: Number(s.points),
    };
  });
  return entries.sort((a, b) => a.rank - b.rank);
}

async function covers() {
  const out = await Promise.allSettled([
    (async () => {
      const days = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
      let found;
      for (let back = 0; back < 3 && !found; back++) {
        const d = new Date(Date.now() - back * DAY);
        const slug = `${days[d.getDay()]}-${d.getDate()}-de-${MONTHS[d.getMonth()].replace('ç', 'c')}-de-${d.getFullYear()}`;
        const html = await get(`https://www.record.pt/capas/detalhe/${slug}`).catch(() => '');
        found = [...html.matchAll(/images\/(\d{4}-\d{2})\/img_467x599uu(\d{4}-\d{2}-\d{2})-([\d-]+)\.jpg/g)].pop();
      }
      if (!found) throw new Error('record cover');
      return {
        source: 'Record', date: found[2], url: 'https://www.record.pt/capas',
        image: `https://cdn.record.pt/images/${found[1]}/img_467x599uu${found[2]}-${found[3]}.jpg`,
      };
    })(),
    (async () => {
      const html = await get('https://www.ojogo.pt/edicao-do-dia.html');
      const date = html.match(/EdTitle">(\d+) de ([a-zç]+), (\d{4})/i);
      const img = html.match(/EdCover"><div class="[^"]*"><a[^>]*href="([^"]+)"/);
      if (!img || !date) throw new Error('ojogo cover');
      const m = String(MONTHS.indexOf(date[2].toLowerCase()) + 1).padStart(2, '0');
      return {
        source: 'O Jogo', date: `${date[3]}-${m}-${date[1].padStart(2, '0')}`,
        url: 'https://www.ojogo.pt/edicao-do-dia.html', image: img[1].replace(/&amp;/g, '&'),
      };
    })(),
    (async () => {
      for (let back = 0; back < 3; back++) {
        const day = new Date(Date.now() - back * DAY).toISOString().slice(0, 10);
        const image = `https://img.kiosko.net/${day.replace(/-/g, '/')}/pt/a_bola.750.jpg`;
        const r = await fetch(image, { method: 'HEAD', headers: UA });
        if (r.ok) return { source: 'A Bola', date: day, url: 'https://pt.kiosko.net/pt/np/a_bola.html', image };
      }
      throw new Error('abola cover');
    })(),
  ]);
  return out.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

async function matchDetail(league, id) {
  if (!COMPETITIONS.some(([c]) => c === league) || !/^\d+$/.test(id)) throw new Error('bad params');
  const d = await fetch(`${ESPN}/site/v2/sports/soccer/${league}/summary?event=${id}`, { headers: UA }).then((r) => r.json());
  const events = (d.keyEvents || [])
    .filter((e) => EVENT_KINDS[e.type?.type])
    .map((e) => {
      const k = EVENT_KINDS[e.type.type];
      const sub = k === 'sub' ? (e.text || '').match(/(\S.*?) replaces (.+?)\./) : null;
      return {
        kind: k,
        own: e.type.type === 'own-goal',
        pen: e.type.type === 'penalty---scored',
        min: e.clock?.displayValue || '',
        team: e.team?.id || '',
        player: sub ? sub[1].replace(/^.*\. /, '') : e.participants?.[0]?.athlete?.displayName || '',
        other: sub ? sub[2].replace(/ because.*$/, '') : k === 'goal' ? e.participants?.[1]?.athlete?.displayName || '' : '',
      };
    });
  const st = (t, n) => t?.statistics?.find((x) => x.name === n)?.displayValue ?? '';
  const teams = (d.boxscore?.teams || []).map((t) => ({
    id: t.team.id,
    name: t.team.shortDisplayName || t.team.displayName,
    logo: t.team.logo || '',
    home: t.homeAway === 'home',
    stats: Object.fromEntries(MATCH_STATS.map((n) => [n, st(t, n)])),
  }));
  const lineups = (d.rosters || []).map((r) => ({
    id: r.team.id,
    formation: r.formation || '',
    starters: (r.roster || []).filter((p) => p.starter).map((p) => ({ n: p.jersey || '', name: p.athlete.displayName })),
  }));
  return { events, teams, lineups };
}

const routes = {
  '/api/podcasts': () => cached('podcasts', 30 * MINUTE, podcasts),
  '/api/videos': () => cached('videos', 10 * MINUTE, videos),
  '/api/scorers': () => cached('scorers', HOUR, scorers),
  '/api/covers': () => cached('covers', HOUR, covers),
  '/api/news': () => cached('news', 5 * MINUTE, news),
  '/api/matches': () => cached('matches', 2 * MINUTE, matches),
  '/api/table': (u) => {
    const l = u.searchParams.get('league') || 'por.1';
    if (!STANDINGS_LEAGUES.includes(l)) throw new Error('bad league');
    return cached(`table:${l}`, 5 * MINUTE, () => table(l));
  },
  '/api/match': (u) => {
    const l = u.searchParams.get('league') || '', id = u.searchParams.get('id') || '';
    return cached(`match:${l}:${id}`, MINUTE, () => matchDetail(l, id));
  },
};

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (routes[url.pathname]) {
      try {
        const data = await routes[url.pathname](url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    const file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`Cosme running at http://localhost:${PORT}`));
