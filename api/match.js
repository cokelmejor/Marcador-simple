export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const KEY = process.env.RAPIDAPI_KEY;
  if (!KEY) return res.status(500).json({ error: 'API key no configurada' });

  const headers = {
    'x-rapidapi-key': KEY,
    'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
  };

  const headersBasket = {
    'x-rapidapi-key': KEY,
    'x-rapidapi-host': 'api-basketball.p.rapidapi.com'
  };

  const headersTennis = {
    'x-rapidapi-key': KEY,
    'x-rapidapi-host': 'tennis-api-atp-wta-itf.p.rapidapi.com'
  };

  // ── Relevancia competiciones de fútbol (ID → score, menor = más relevante) ──
  const FOOTBALL_RELEVANCE = {
    2: 1, 3: 2, 848: 3,          // UCL, UEL, UECL
    39: 4, 140: 5, 135: 6,       // PL, LaLiga, Serie A
    78: 7, 61: 8, 94: 9,         // Bundesliga, Ligue 1, Primeira Liga
    88: 10, 144: 11, 203: 12,    // Eredivisie, Belgian, Süper Lig
    253: 13, 307: 14,            // MLS, Saudi Pro
    143: 15, 45: 16, 137: 17, 66: 18, // Copas
    1: 20, 4: 21,                // Selecciones
  };

  const BASKETBALL_RELEVANCE = {
    12: 1,   // NBA
    120: 2,  // EuroLeague
    119: 3,  // EuroCup
    116: 4,  // ACB Liga Endesa
    117: 5,  // Lega Basket Italy
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const now  = Math.floor(Date.now() / 1000);
  const in8h = now + 8 * 3600;
  const todayStr = new Date().toISOString().split('T')[0];

  function toMadrid(ts) {
    return new Date(ts * 1000).toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });
  }

  async function safeFetch(url, hdrs) {
    try {
      const r = await fetch(url, { headers: hdrs });
      const j = await r.json();
      return j.response || [];
    } catch { return []; }
  }

  // ── 1. Partidos en vivo (fútbol) ─────────────────────────────────────────────
  const liveFootball = await safeFetch(
    'https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all',
    headers
  );

  if (liveFootball.length > 0) {
    const fixture  = liveFootball[0];
    const fixtureId = fixture.fixture.id;

    const [eventsArr, statsArr] = await Promise.all([
      safeFetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/events?fixture=${fixtureId}`, headers),
      safeFetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`, headers)
    ]);

    const getStatVal = (teamId, type) => {
      const t  = statsArr.find(s => s.team.id === teamId);
      if (!t) return null;
      const st = t.statistics.find(s => s.type === type);
      return st ? st.value : null;
    };

    const homeId = fixture.teams.home.id;
    const awayId = fixture.teams.away.id;

    const goals       = eventsArr.filter(e => e.type === 'Goal' && e.detail !== 'Missed Penalty');
    const yellowCards = eventsArr.filter(e => e.type === 'Card' && e.detail === 'Yellow Card');
    const lastEvent   = eventsArr[eventsArr.length - 1];
    const varActive   = lastEvent && lastEvent.type === 'Var' &&
      !['Goal cancelled', 'No Goal'].includes(lastEvent.detail);

    const elapsed     = fixture.fixture.status.elapsed || 0;
    const extra       = fixture.fixture.status.extra   || null;
    const statusShort = fixture.fixture.status.short;

    let addedTime = null;
    if (statusShort === '1H' && elapsed >= 45) addedTime = extra || (elapsed - 45);
    if (statusShort === '2H' && elapsed >= 90) addedTime = extra || (elapsed - 90);

    let minuteDisplay = elapsed ? `${elapsed}'` : null;
    if (addedTime !== null && addedTime > 0) {
      const base = statusShort === '1H' ? 45 : 90;
      minuteDisplay = `${base}+${addedTime}'`;
    }

    const fmtGoals = teamId => goals
      .filter(e => e.team.id === teamId)
      .map(e => ({
        player: e.player?.name || '?',
        minute: String(e.time.elapsed) + (e.time.extra ? `+${e.time.extra}` : ''),
        type: e.detail === 'Own Goal' ? 'og' : e.detail === 'Penalty' ? 'pen' : 'goal'
      }));

    const fmtYellows = teamId => yellowCards
      .filter(e => e.team.id === teamId)
      .map(e => ({
        player: e.player?.name || '?',
        minute: String(e.time.elapsed) + (e.time.extra ? `+${e.time.extra}` : '')
      }));

    return res.json({
      match: {
        id: fixtureId,
        league: fixture.league.name,
        sport: 'football',
        isLive: true,
        status: statusShort,
        statusLong: fixture.fixture.status.long,
        minute: minuteDisplay,
        minuteRaw: elapsed,
        addedTime,
        home: {
          id: homeId,
          name:  fixture.teams.home.name,
          logo:  fixture.teams.home.logo,
          score: fixture.goals.home ?? 0,
          goals: fmtGoals(homeId),
          yellowCards: fmtYellows(homeId)
        },
        away: {
          id: awayId,
          name:  fixture.teams.away.name,
          logo:  fixture.teams.away.logo,
          score: fixture.goals.away ?? 0,
          goals: fmtGoals(awayId),
          yellowCards: fmtYellows(awayId)
        },
        varReview: varActive
          ? { detail: lastEvent.detail, team: lastEvent.team?.name }
          : null,
        stats: {
          possessionHome: getStatVal(homeId, 'Ball Possession'),
          possessionAway: getStatVal(awayId, 'Ball Possession'),
          shotsHome:   getStatVal(homeId, 'Shots on Goal'),
          shotsAway:   getStatVal(awayId, 'Shots on Goal'),
          foulsHome:   getStatVal(homeId, 'Fouls'),
          foulsAway:   getStatVal(awayId, 'Fouls'),
          cornersHome: getStatVal(homeId, 'Corner Kicks'),
          cornersAway: getStatVal(awayId, 'Corner Kicks'),
          yellowHome:  getStatVal(homeId, 'Yellow Cards'),
          yellowAway:  getStatVal(awayId, 'Yellow Cards')
        }
      },
      totalLive: liveFootball.length
    });
  }

  // ── 2. Sin partidos en vivo: próximas 8 horas (fútbol + baloncesto + tenis) ──

  // Llamadas en paralelo
  const [footballUpcoming, basketUpcoming, tennisUpcoming] = await Promise.all([
    safeFetch(
      `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${todayStr}&status=NS`,
      headers
    ),
    safeFetch(
      `https://api-basketball.p.rapidapi.com/games?date=${todayStr}`,
      headersBasket
    ),
    safeFetch(
      `https://tennis-api-atp-wta-itf.p.rapidapi.com/tennis/v2/atp/h2h/day/${todayStr}`,
      headersTennis
    )
  ]);

  const upcoming = [];

  // ── FÚTBOL ────────────────────────────────────────────────────────────────────
  for (const f of footballUpcoming) {
    const ts = f.fixture?.timestamp;
    if (!ts || ts < now || ts > in8h) continue;
    upcoming.push({
      sport:              'football',
      sportIcon:          '⚽',
      competition:        f.league.name,
      competitionCountry: f.league.country,
      competitionLogo:    f.league.logo,
      home:      f.teams.home.name,
      homeLogo:  f.teams.home.logo,
      away:      f.teams.away.name,
      awayLogo:  f.teams.away.logo,
      timestamp: ts,
      time:      toMadrid(ts),
      relevance: FOOTBALL_RELEVANCE[f.league.id] ?? 99
    });
  }

  // ── BALONCESTO ────────────────────────────────────────────────────────────────
  for (const b of basketUpcoming) {
    const dateStr = b.date || b.time;
    const ts = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : null;
    if (!ts || ts < now || ts > in8h) continue;
    const status = b.status?.short;
    if (status === 'FT' || status === 'AOT' || status === 'OT') continue;
    upcoming.push({
      sport:              'basketball',
      sportIcon:          '🏀',
      competition:        b.league?.name || 'Baloncesto',
      competitionCountry: b.country?.name || '',
      competitionLogo:    b.league?.logo  || '',
      home:      b.teams?.home?.name || '?',
      homeLogo:  b.teams?.home?.logo || '',
      away:      b.teams?.away?.name || '?',
      awayLogo:  b.teams?.away?.logo || '',
      timestamp: ts,
      time:      toMadrid(ts),
      relevance: BASKETBALL_RELEVANCE[b.league?.id] ?? 50
    });
  }

  // ── TENIS ─────────────────────────────────────────────────────────────────────
  // La API de tenis puede devolver array directo o { results: [] }
  const tennisMatches = Array.isArray(tennisUpcoming)
    ? tennisUpcoming
    : (tennisUpcoming?.results || []);

  for (const t of tennisMatches) {
    const dateRaw = t.date || t.start_at || t.scheduled;
    const ts = dateRaw ? Math.floor(new Date(dateRaw).getTime() / 1000) : null;
    if (!ts || ts < now || ts > in8h) continue;
    const p1 = t.player1?.full_name || t.player1?.name || t.home_player || '?';
    const p2 = t.player2?.full_name || t.player2?.name || t.away_player || '?';
    upcoming.push({
      sport:              'tennis',
      sportIcon:          '🎾',
      competition:        t.tournament?.name || t.event?.name || 'ATP/WTA',
      competitionCountry: t.tournament?.country || '',
      competitionLogo:    '',
      home:      p1,
      homeLogo:  '',
      away:      p2,
      awayLogo:  '',
      timestamp: ts,
      time:      toMadrid(ts),
      relevance: 30
    });
  }

  // ── Ordenar: relevancia → hora ────────────────────────────────────────────────
  upcoming.sort((a, b) =>
    a.relevance !== b.relevance
      ? a.relevance - b.relevance
      : a.timestamp - b.timestamp
  );

  // ── Agrupar por competición ───────────────────────────────────────────────────
  const grouped = {};
  for (const u of upcoming) {
    const country = u.competitionCountry ? ` · ${u.competitionCountry}` : '';
    const key = `${u.sportIcon} ${u.competition}${country}`;
    if (!grouped[key]) {
      grouped[key] = {
        sport:     u.sport,
        sportIcon: u.sportIcon,
        logo:      u.competitionLogo,
        relevance: u.relevance,
        matches:   []
      };
    }
    grouped[key].matches.push({
      home:      u.home,
      homeLogo:  u.homeLogo,
      away:      u.away,
      awayLogo:  u.awayLogo,
      timestamp: u.timestamp,
      time:      u.time
    });
  }

  // Ordenar grupos por relevancia
  const groupedSorted = Object.fromEntries(
    Object.entries(grouped).sort((a, b) => a[1].relevance - b[1].relevance)
  );

  return res.json({ match: null, upcoming: groupedSorted });
}
