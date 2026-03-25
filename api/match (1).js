export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── Proxy de logos ──────────────────────────────────────────────
  // El navegador no puede pedir imágenes a api.sofascore.app (CORS),
  // pero el servidor sí puede. Las servimos desde /api/match?logo=…
  if (req.method === 'GET' && req.query.logo) {
    try {
      const imgRes = await fetch(req.query.logo, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.sofascore.com/',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
        }
      });
      if (!imgRes.ok) return res.status(404).end();
      const buf = await imgRes.arrayBuffer();
      res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(Buffer.from(buf));
    } catch {
      return res.status(502).end();
    }
  }

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY no configurada en Vercel' });
  }

  const HEADERS = {
    'x-rapidapi-key': key,
    'x-rapidapi-host': 'sportapi7.p.rapidapi.com',
    'Content-Type': 'application/json'
  };

  // Helper: sirve logos a través del proxy para evitar bloqueos CORS
  function proxyLogo(url) {
    if (!url) return null;
    return `/api/match?logo=${encodeURIComponent(url)}`;
  }

  const SPORTS = ['football', 'tennis', 'basketball'];

  try {
    // 1. Buscar partidos en vivo
    let liveEvent = null;
    let totalLive = 0;

    for (const sport of SPORTS) {
      const r = await fetch(
        `https://sportapi7.p.rapidapi.com/api/v1/sport/${sport}/events/live`,
        { headers: HEADERS }
      );
      const d = await r.json();
      const events = d.events || [];
      if (events.length > 0 && !liveEvent) {
        liveEvent = { event: events[0], sport };
      }
      totalLive += events.length;
    }

    // 2. Próximos partidos de hoy (fútbol)
    const today = new Date().toISOString().split('T')[0];
    const upcomingRes = await fetch(
      `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${today}/inverse`,
      { headers: HEADERS }
    );
    const upcomingData = await upcomingRes.json();
    const allToday = upcomingData.events || [];

    const upcoming = allToday
      .filter(e => e.status?.type === 'notstarted')
      .slice(0, 5)
      .map(e => ({
        id:        e.id,
        sport:     'football',
        league:    e.tournament?.name || e.tournament?.uniqueTournament?.name || '–',
        home:      e.homeTeam?.name || '–',
        away:      e.awayTeam?.name || '–',
        homeLogo:  proxyLogo(e.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` : null),
        awayLogo:  proxyLogo(e.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` : null),
        time:      e.startTimestamp
          ? new Date(e.startTimestamp * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : '–',
        timestamp: e.startTimestamp || null
      }));

    if (!liveEvent) {
      return res.status(200).json({ match: null, message: 'Sin partidos en vivo', upcoming, totalLive: 0 });
    }

    const e = liveEvent.event;
    const homeTeam   = e.homeTeam  || {};
    const awayTeam   = e.awayTeam  || {};
    const homeScore  = e.homeScore || {};
    const awayScore  = e.awayScore || {};
    const status     = e.status    || {};
    const tournament = e.tournament || {};

    // 3. Obtener estadísticas del partido en vivo
    let stats = {
      possessionHome: null, possessionAway: null,
      shotsHome: null,      shotsAway: null,
      foulsHome: null,      foulsAway: null,
      cornersHome: null,    cornersAway: null,
      yellowHome: null,     yellowAway: null,
    };

    try {
      const statsRes = await fetch(
        `https://sportapi7.p.rapidapi.com/api/v1/event/${e.id}/statistics`,
        { headers: HEADERS }
      );
      const statsData = await statsRes.json();

      // Prefer the "ALL" period; fall back to the last or first available
      const allPeriods = statsData.statistics || [];
      const period =
        allPeriods.find(p => (p.period || '').toUpperCase() === 'ALL') ||
        allPeriods[allPeriods.length - 1] ||
        allPeriods[0];
      const groups = period?.groups || [];

      function findStat(groups, ...names) {
        for (const g of groups) {
          for (const item of g.statisticsItems || []) {
            const n = (item.name || '').toLowerCase();
            if (names.some(name => n.includes(name.toLowerCase()))) {
              return { home: item.home ?? null, away: item.away ?? null };
            }
          }
        }
        return { home: null, away: null };
      }

      const poss    = findStat(groups, 'Ball possession', 'possession');
      const shots   = findStat(groups, 'Shots on target', 'on target');
      const fouls   = findStat(groups, 'Fouls');
      const corners = findStat(groups, 'Corner kicks', 'corners');
      const yellow  = findStat(groups, 'Yellow cards');

      stats = {
        possessionHome: poss.home,    possessionAway: poss.away,
        shotsHome:      shots.home,   shotsAway:      shots.away,
        foulsHome:      fouls.home,   foulsAway:      fouls.away,
        cornersHome:    corners.home, cornersAway:    corners.away,
        yellowHome:     yellow.home,  yellowAway:     yellow.away,
      };
    } catch (statsErr) {
      // Si las stats fallan, seguimos sin ellas
      console.error('Stats fetch failed:', statsErr.message);
    }

    // 4. Extraer minuto numérico para que el frontend pueda interpolar
    let minuteRaw = status.description || null;
    let minuteNum = null;

    // Only extract minute if description looks like a game time ("23'", "45+2'", "90")
    // Avoid extracting "1" from "1st Half" etc.
    if (minuteRaw) {
      const mm = minuteRaw.match(/^(\d+)(?:\+\d+)?[''']?$/);
      if (mm) minuteNum = parseInt(mm[1], 10);
    }

    // Fallback: calculate from period start timestamp (most accurate)
    const periodStart = e.time?.currentPeriodStartTimestamp || null;
    const periodNum   = e.time?.period || null;

    // If we still don't have minuteNum, try e.time.played (seconds)
    if (minuteNum === null && e.time?.played !== undefined) {
      minuteNum = Math.floor(e.time.played / 60);
    }

    res.status(200).json({
      match: {
        id:         e.id,
        sport:      liveEvent.sport,
        league:     tournament.name || tournament.uniqueTournament?.name || '–',
        leagueLogo: proxyLogo(tournament.uniqueTournament?.id
          ? `https://api.sofascore.app/api/v1/unique-tournament/${tournament.uniqueTournament.id}/image`
          : null),
        minute:      minuteRaw,
        minuteNum:   minuteNum,       // número puro para interpolar el reloj
        periodStart: periodStart,     // Unix timestamp (s) inicio del período actual
        period:      periodNum,       // 1 = primera parte, 2 = segunda, etc.
        status:      status.type || '–',
        statusLong:  status.description || status.type || '–',
        isLive:      ['inprogress', 'live', '1h', '2h', 'overtime', 'ext'].includes(
                       (status.type || '').toLowerCase()
                     ),
        isHalfTime:  ['halftime', 'pause', 'ht'].includes(
                       (status.type || '').toLowerCase()
                     ),
        home: {
          name:  homeTeam.name || homeTeam.shortName || '–',
          logo:  proxyLogo(homeTeam.id ? `https://api.sofascore.app/api/v1/team/${homeTeam.id}/image` : null),
          score: homeScore.current ?? homeScore.display ?? 0,
        },
        away: {
          name:  awayTeam.name || awayTeam.shortName || '–',
          logo:  proxyLogo(awayTeam.id ? `https://api.sofascore.app/api/v1/team/${awayTeam.id}/image` : null),
          score: awayScore.current ?? awayScore.display ?? 0,
        },
        stats,
        updated:   new Date().toISOString(),
        updatedTs: Date.now()        // timestamp para sincronizar el reloj interpolado
      },
      totalLive,
      upcoming
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
