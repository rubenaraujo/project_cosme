# Cosme

A minimalist, single-page dashboard for Benfica fans. It gathers football news from Portuguese sports press, shows the latest results, upcoming fixtures, league tables and top scorers, and plays Benfica podcasts in the page.

The server has no dependencies and the frontend is plain HTML, CSS and JavaScript. The UI is in Portuguese.

## Features

- **News**: Benfica first-team football stories from Record, O Jogo and A Bola, with images. Paywalled and non-football items are filtered out. Each card links to the original article.
- **Opinion**: analysis and debate videos. Record videos play in-site; A Bola videos open at the source.
- **Podcasts**: *Falar Benfica* and *Canto do Benfica*, played with the native audio element.
- **Transfers**: news filtered to transfer-market topics.
- **Matches**: results and fixtures across Liga, Liga Europa and Taça de Portugal, with a detail view (events, stats, line-ups).
- **Tables**: Liga and Liga Europa standings, plus top scorers and assisters.
- **Front pages**: today's covers of Record, O Jogo and A Bola.
- Dark theme only.

## Requirements

Node.js 18 or newer (global `fetch` and `AbortSignal.timeout`).

## Run

```bash
node server.js          # http://localhost:3000
PORT=8080 node server.js
```

## API

All responses are JSON and cached in memory. If a refresh fails, the last good response is served.

| Endpoint | Description | Cache |
|---|---|---|
| `/api/news` | Aggregated news | 5 min |
| `/api/videos` | Opinion videos | 10 min |
| `/api/podcasts` | Latest podcast episodes | 30 min |
| `/api/matches` | Results, live and upcoming matches | 2 min |
| `/api/match?league=&id=` | Match events, stats and line-ups | 1 min |
| `/api/table?league=por.1\|uefa.europa` | League standings | 5 min |
| `/api/scorers` | Top scorers and assisters | 1 h |
| `/api/covers` | Newspaper front pages | 1 h |

## Project structure

```
server.js        Scrapers, ESPN mappers, API routes and static file server
public/
  index.html     Page markup
  style.css      Styles
  app.js         Rendering and interactions
  logo.png       Logo
```

## Data sources

- News, videos and covers: [Record](https://www.record.pt), [O Jogo](https://www.ojogo.pt), [A Bola](https://www.abola.pt) (RSS and page metadata) and [Kiosko](https://pt.kiosko.net).
- Competition logos: ESPN; the Taça de Portugal logo comes from [football-logos.cc](https://football-logos.cc).
- Matches, standings and scorers: ESPN's public site API.
- Podcasts: the shows' public RSS feeds.

## Notes

- Scraping depends on third-party markup and can break when those sites change.
- Cosme shows headlines, summaries and thumbnails only. Full articles are not reproduced; every story links to its original publisher.
- All content belongs to its respective authors and publishers.
- The logo is a placeholder: a licence is required before public use.
- Cosme is an unofficial fan project with no affiliation to Sport Lisboa e Benfica or any of the sources above.
