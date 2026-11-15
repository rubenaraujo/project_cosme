const $ = (id) => document.getElementById(id);
const ME = '1929';
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (u) => fetch(u).then((r) => r.json());

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }).replace('.', '');
const fmtTime = (d) => new Date(d).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

function ago(d) {
  if (!d) return '';
  const m = Math.max(0, (Date.now() - new Date(d)) / 60000);
  if (m < 60) return `há ${Math.round(m) || 1} min`;
  if (m < 1440) return `há ${Math.round(m / 60)} h`;
  return fmtDate(d);
}

let allNews = [];
const PAGE = 10;
let shown = PAGE + 1;

const metaLine = (n) => `<div class="meta"><span class="src">${esc(n.source)}</span><span>${ago(n.date)}</span></div>`;
const thumb = (url, onError = 'this.remove()') =>
  url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="${onError}">` : '';
const link = (cls, n, inner) => `<a class="${cls}" href="${esc(n.url)}" target="_blank" rel="noopener">${inner}</a>`;

function newsCard(n, i) {
  const img = `<div class="img">${thumb(n.image)}</div>`;
  if (i === 0) {
    const text = `${metaLine(n)}<h3>${esc(n.title)}</h3>${n.description ? `<p>${esc(n.description)}</p>` : ''}`;
    return link('art hero-art', n, `${img}<div class="txt">${text}</div>`);
  }
  if (i <= 4) return link('art', n, `${img}${metaLine(n)}<h3>${esc(n.title)}</h3>`);
  return link('art row', n, `${img}<div class="rt">${metaLine(n)}<h3>${esc(n.title)}</h3></div>`);
}

function renderNews() {
  const items = allNews.slice(0, shown);
  $('news').innerHTML = items.length ? items.map(newsCard).join('') : '<p class="muted">Sem notícias.</p>';
  $('more').hidden = allNews.length <= shown;
}

$('more').addEventListener('click', () => {
  shown += PAGE;
  renderNews();
});

function outcome(m) {
  const home = m.home.id === ME;
  const a = +m.home.score, b = +m.away.score;
  const mine = home ? a : b, theirs = home ? b : a;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}
const PT = { W: 'V', D: 'E', L: 'D' };
const badge = (r) => `<span class="badge ${r}">${PT[r]}</span>`;

let matchData = null;
let tableData = null;
function renderNext() {
  if (!matchData) return;
  const m = matchData.live[0] || matchData.fixtures[0];
  if (!m) {
    $('next').innerHTML = '<p>Sem jogos agendados.</p>';
    return;
  }
  const live = !!matchData.live[0];
  const comp = m.competitionLogo
    ? `<img class="comp-logo" src="${m.competitionLogo}" alt="${esc(m.competition)}" title="${esc(m.competition)}">`
    : `<span class="comp-name">${esc(m.competition)}</span>`;
  const when = live ? `${m.home.score}–${m.away.score}` : `${fmtDate(m.date)}<small>${fmtTime(m.date)}</small>`;
  const side = (t) => `<div class="side"><img src="${t.logo}" alt="">${esc(t.name)}</div>`;
  $('next').innerHTML = `
    ${live ? '<div class="kicker"><span class="live">Em jogo</span></div>' : ''}
    <div class="vs-row">
      ${side(m.home)}
      <div class="mid ${live ? 'score' : ''}">${comp}<span class="when">${when}</span></div>
      ${side(m.away)}
    </div>`;
}

function renderStanding() {
  if (!tableData) return;
  const me = tableData.find((r) => r.id === ME);
  if (!me) return;
  const lead = tableData[0];
  const form = (matchData?.results || []).slice(0, 5).reverse().map((m) => badge(outcome(m))).join('');
  const gap = me.rank === 1 ? 'Líder do campeonato' : `A ${lead.points - me.points} pts do ${esc(lead.name)}`;
  $('standing').innerHTML = `
    <div>
      <div class="pos"><b>${me.rank}<sup>.º</sup></b><span>${me.points} pts</span><em class="gap">${gap}</em></div>
    </div>
    <div class="stats">
      <div><b>${me.played}</b><small>Jogos</small></div>
      <div><b>${me.wins}</b><small>Vitórias</small></div>
      <div><b>${me.draws}</b><small>Empates</small></div>
      <div><b>${me.losses}</b><small>Derrotas</small></div>
    </div>
    ${form ? `<div class="form"><span class="kicker">Forma</span>${form}</div>` : ''}`;
}

function renderMatches(d) {
  matchData = d;
  renderNext();
  renderStanding();
  $('results').innerHTML = d.results.slice(0, 5).map((m) => matchRow(m, true)).join('');
  $('fixtures').innerHTML = d.fixtures.slice(0, 5).map((m) => matchRow(m, false)).join('');
}

function matchRow(m, played) {
  const result = played ? outcome(m) : '';
  const [h, a] = [+m.home.score, +m.away.score];
  const side = (t, score, wins) => `<div class="tm ${t.id === ME ? 'me' : ''}"><img src="${t.logo}" alt=""><span>${esc(t.name)}</span>${played ? `<b class="${wins ? 'win' : ''}">${score}</b>` : ''}</div>`;
  const attrs = played ? ` go" role="button" tabindex="0" data-league="${m.league}" data-id="${m.id}` : '';
  return `<div class="m${attrs}" ${result ? `data-r="${result}"` : ''}>
    <div class="m-meta"><span>${fmtDate(m.date)}</span><span class="cp">${esc(m.competition)}</span></div>
    <div class="m-body">
      <div class="m-teams">${side(m.home, m.home.score, h > a)}${side(m.away, m.away.score, a > h)}</div>
      ${played ? `<span class="m-res">${PT[result]}</span>` : `<span class="m-time">${fmtTime(m.date)}</span>`}
    </div></div>`;
}

$('pane-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pane]');
  if (!b) return;
  document.querySelectorAll('#pane-tabs button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', x === b);
  });
  ['results', 'fixtures'].forEach((id) => ($(id).hidden = id !== b.dataset.pane));
});

let tableLeague = 'por.1';
const tableCache = {};
function renderTable(rows, league = 'por.1') {
  tableCache[league] = rows;
  if (league === 'por.1') {
    tableData = rows;
    renderStanding();
  }
  if (league !== tableLeague) return;
  const meIdx = rows.findIndex((r) => r.id === ME);
  const size = 18;
  const start = Math.max(0, Math.min(meIdx - 9, rows.length - size));
  const view = rows.slice(start, start + size);
  $('table').innerHTML = `<table>
    <tr><th>#</th><th>Equipa</th><th>J</th><th>V</th><th>E</th><th>D</th><th>DG</th><th>Pts</th></tr>
    ${view
      .map(
        (r) => `<tr class="${r.id === ME ? 'me' : ''}"><td>${r.rank}</td>
      <td><div><img src="${r.logo}" alt="">${esc(r.name)}</div></td>
      <td>${r.played}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${r.gd}</td><td class="p">${r.points}</td></tr>`
      )
      .join('')}</table>`;
}
$('table-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-league]');
  if (!b) return;
  document.querySelectorAll('#table-tabs button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', x === b);
  });
  tableLeague = b.dataset.league;
  if (tableCache[tableLeague]) return renderTable(tableCache[tableLeague], tableLeague);
  $('table').innerHTML = '<div class="sk sk-list"></div>';
  json(`/api/table?league=${tableLeague}`).then((r) => renderTable(r, tableLeague)).catch(() => ($('table').innerHTML = '<p class="muted">Classificação indisponível.</p>'));
});

let coverList = [], lbIdx = 0;
function renderCovers(list) {
  coverList = list;
  $('covers').innerHTML = list
    .map(
      (c, i) => `<a class="cover" data-i="${i}" href="${esc(c.url)}" target="_blank" rel="noopener">
      <img src="${esc(c.image)}" alt="Capa ${esc(c.source)}" loading="lazy" referrerpolicy="no-referrer"></a>`
    )
    .join('');
}
function showCover(i) {
  if (!coverList.length) return;
  lbIdx = (i + coverList.length) % coverList.length;
  const c = coverList[lbIdx];
  $('lb-img').src = c.image;
  $('lb-img').alt = 'Capa ' + c.source;
  $('lb-open').href = c.url;
  if (!$('lightbox').open) $('lightbox').showModal();
}
$('covers').addEventListener('click', (e) => {
  const a = e.target.closest('.cover');
  if (!a) return;
  e.preventDefault();
  showCover(+a.dataset.i);
});
$('lb-close').onclick = () => $('lightbox').close();
$('lb-prev').onclick = () => showCover(lbIdx - 1);
$('lb-next').onclick = () => showCover(lbIdx + 1);
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox') || e.target === $('lb-img')) $('lightbox').close(); });
document.addEventListener('keydown', (e) => {
  if (!$('lightbox').open) return;
  if (e.key === 'ArrowLeft') showCover(lbIdx - 1);
  if (e.key === 'ArrowRight') showCover(lbIdx + 1);
});

let scorerTab = 'scorers';
let scorerData = null;
function renderScorers(data = scorerData) {
  if (!data) return;
  scorerData = data;
  const key = scorerTab === 'scorers' ? 'goals' : 'assists';
  const rows = data[scorerTab];
  $('scorers').innerHTML = `<div class="sc-tabs">
    <button type="button" data-t="scorers" class="${scorerTab === 'scorers' ? 'on' : ''}">Golos</button>
    <button type="button" data-t="assisters" class="${scorerTab === 'assisters' ? 'on' : ''}">Assistências</button></div>
    ${rows.map((p, i) => `<div class="sc-row"><i>${i + 1}</i><div class="sc-n"><span>${esc(p.name)}</span><div class="bar-t"><div style="width:${Math.round((p[key] / (rows[0][key] || 1)) * 100)}%"></div></div></div><b>${p[key]}</b></div>`).join('') || '<p class="muted">Sem dados.</p>'}`;
}
$('scorers').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-t]');
  if (b) { scorerTab = b.dataset.t; renderScorers(); }
});

const reader = $('reader');
function openReader(video) {
  $('rd-body').innerHTML = `<video controls autoplay playsinline poster="${esc(video.image)}" src="${esc(video.video)}"></video>
    <div class="rd-txt">
      ${metaLine(video)}
      <h3>${esc(video.title)}</h3>
      ${video.description ? `<p>${esc(video.description)}</p>` : ''}
      <a class="rd-open" href="${esc(video.url)}" target="_blank" rel="noopener">Ver no site de origem</a>
    </div>`;
  reader.showModal();
}
reader.addEventListener('close', () => { $('rd-body').innerHTML = ''; });
reader.addEventListener('click', (e) => { if (e.target === reader) reader.close(); });
$('rd-close').onclick = () => reader.close();
$('videos').addEventListener('click', (e) => {
  const a = e.target.closest('a.vid');
  if (!a) return;
  const v = videoList.find((x) => x.url === a.href);
  if (v?.video) { e.preventDefault(); openReader(v); }
});

const MARKET_RE = /transfer|contrat[oaçd]|rescis|mercado|empr[ée]stimo|emprestad|refor[çc]|renova[çrv]|cl[áa]usula|opção de compra|\bassin(a|ou|atura)\b/i;
function renderMarket() {
  const items = allNews.filter((n) => MARKET_RE.test(n.title));
  $('market').innerHTML = items.length
    ? items.map((n) => link('art', n, `<div class="img">${thumb(n.image)}</div>${metaLine(n)}<h3>${esc(n.title)}</h3>`)).join('')
    : '<p class="muted">Sem notícias de mercado.</p>';
}

const matchDlg = $('match');
const ICON = { goal: '⚽', yellow: '<i class="cd y"></i>', red: '<i class="cd r"></i>', sub: '⇄' };
const STAT = [['possessionPct', 'Posse de bola', '%'], ['totalShots', 'Remates'], ['shotsOnTarget', 'Remates à baliza'], ['wonCorners', 'Cantos'], ['foulsCommitted', 'Faltas'], ['offsides', 'Foras de jogo'], ['passPct', 'Passes certos', '%']];
const num = (v) => parseFloat(v) || 0;
function statVal(k, v) {
  if (k === 'passPct') return `${Math.round(num(v) <= 1 ? num(v) * 100 : num(v))}`;
  return `${Math.round(num(v))}`;
}
async function openMatch(league, id) {
  const m = [...matchData.results, ...matchData.live].find((x) => x.id === id);
  if (!m) return;
  $('md-body').innerHTML = `<div class="md-head">
    <div class="md-comp">${esc(m.competition)} · ${fmtDate(m.date)}</div>
    <div class="md-score"><div class="t r">${esc(m.home.name)}<img src="${m.home.logo}" alt=""></div><b>${m.home.score}–${m.away.score}</b><div class="t"><img src="${m.away.logo}" alt="">${esc(m.away.name)}</div></div>
  </div><div id="md-det" class="md-det"><div class="sk sk-list"></div></div>`;
  matchDlg.showModal();
  try {
    const d = await json(`/api/match?league=${league}&id=${id}`);
    const line = (e) => {
      const home = e.team === m.home.id;
      const txt = e.kind === 'sub'
        ? `<span class="in">${esc(e.player)}</span> <small>por ${esc(e.other)}</small>`
        : `<b>${esc(e.player)}${e.own ? ' (p.b.)' : ''}${e.pen ? ' (g.p.)' : ''}</b>${e.other ? ` <small>ass. ${esc(e.other)}</small>` : ''}`;
      return `<div class="ev ${home ? 'h' : 'a'} ${e.kind}"><span class="mn">${esc(e.min)}</span><span class="ic">${ICON[e.kind]}</span><span class="tx">${txt}</span></div>`;
    };
    const evs = d.events.length ? d.events.map(line).join('') : '<p class="muted">Sem eventos disponíveis.</p>';
    const [th, ta] = [d.teams.find((t) => t.home), d.teams.find((t) => !t.home)];
    const stats = th && ta
      ? STAT.filter(([k]) => th.stats[k] !== '' || ta.stats[k] !== '').map(([k, label]) => {
          const x = num(th.stats[k]), y = num(ta.stats[k]), t = x + y || 1;
          return `<div class="st"><div class="st-l"><b>${statVal(k, th.stats[k])}</b><span>${label}</span><b>${statVal(k, ta.stats[k])}</b></div><div class="sbar"><i style="width:${(x / t) * 100}%"></i><i class="b" style="width:${(y / t) * 100}%"></i></div></div>`;
        }).join('')
      : '';
    const lu = d.lineups.length
      ? `<div class="lu">${[m.home, m.away].map((tm) => {
          const l = d.lineups.find((x) => x.id === tm.id);
          return l ? `<div><h4>${esc(tm.name)} <small>${esc(l.formation)}</small></h4>${l.starters.map((p) => `<div class="pl"><i>${esc(p.n)}</i>${esc(p.name)}</div>`).join('')}</div>` : '';
        }).join('')}</div>`
      : '';
    $('md-det').innerHTML = `<h4 class="md-h">Eventos</h4><div class="evs">${evs}</div>${stats ? `<h4 class="md-h">Estatísticas</h4>${stats}` : ''}${lu ? `<h4 class="md-h">Onze inicial</h4>${lu}` : ''}`;
  } catch {
    $('md-det').innerHTML = '<p class="muted">Detalhe indisponível.</p>';
  }
}
['results', 'fixtures'].forEach((id) => {
  const open = (e) => {
    const r = e.target.closest('.m.go');
    if (r && (e.type === 'click' || e.key === 'Enter')) openMatch(r.dataset.league, r.dataset.id);
  };
  $(id).addEventListener('click', open);
  $(id).addEventListener('keydown', open);
});
$('md-close').onclick = () => matchDlg.close();
matchDlg.addEventListener('click', (e) => { if (e.target === matchDlg) matchDlg.close(); });

let videoList = [];
const PLAY_ICON = '<span class="play" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>';
function renderVideos() {
  $('videos').innerHTML = videoList.length
    ? videoList
        .map((v) => link('vid', v, `<div class="img">${thumb(v.image, "this.closest('.vid').remove()")}${PLAY_ICON}</div>${metaLine(v)}<h3>${esc(v.title)}</h3>`))
        .join('')
    : '<p class="muted">Sem vídeos de opinião.</p>';
}
document.querySelector('.main-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-main]');
  if (!b) return;
  document.querySelectorAll('.main-tabs button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-selected', x === b);
  });
  const t = b.dataset.main;
  $('news').hidden = t !== 'news';
  $('videos').hidden = t !== 'videos';
  $('podcasts').hidden = t !== 'podcasts';
  $('market').hidden = t !== 'market';
  $('more').hidden = t !== 'news' || allNews.length <= shown;
  if (t !== 'podcasts') document.querySelectorAll('#podcasts audio').forEach((x) => x.pause());
});

function renderPodcasts(list) {
  $('podcasts').innerHTML = list.length
    ? list
        .map(
          (p) => `<article class="pod">
      <img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <div class="pod-b">
        <div class="meta"><span class="src">${esc(p.show)}</span><span>${ago(p.date)}</span>${p.duration ? `<span>${esc(p.duration)}</span>` : ''}</div>
        <h3>${esc(p.title)}</h3>
        <audio controls preload="none" src="${esc(p.audio)}"></audio>
      </div>
    </article>`
        )
        .join('')
    : '<p class="muted">Sem podcasts disponíveis.</p>';
}
$('podcasts').addEventListener('play', (e) => {
  document.querySelectorAll('#podcasts audio').forEach((x) => { if (x !== e.target) x.pause(); });
}, true);

async function load() {
  json('/api/videos').then((d) => { videoList = d.items; renderVideos(); }).catch(() => {});
  json('/api/podcasts').then((d) => renderPodcasts(d.items)).catch(() => {});
  json('/api/covers').then(renderCovers).catch(() => {});
  json('/api/news').then((d) => { allNews = d.items; renderNews(); renderMarket(); }).catch(() => ($('news').innerHTML = '<p class="muted">Erro ao carregar notícias.</p>'));
  json('/api/matches').then(renderMatches).catch(() => {});
  json('/api/table').then((r) => renderTable(r, 'por.1')).catch(() => {});
  json('/api/scorers').then(renderScorers).catch(() => {});
}
load();
setInterval(load, 5 * 60 * 1000);
