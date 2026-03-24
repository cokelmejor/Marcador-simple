export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    return res.status(500).json({ error: 'RAPIDAPI_KEY no configurada en Vercel' });
  }

  const HEADERS = {
    'x-rapidapi-key': key,
    'x-rapidapi-host': 'sportapi7.p.rapidapi.com',
    'Content-Type': 'application/json'
  };

  // Sports to check for live events (add more in the future)
  const SPORTS = ['football', 'tennis', 'basketball'];

  try {
    // 1. Try each sport for live events
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

    // 2. Get upcoming events for today (football only for now)
    const today = new Date().toISOString().split('T')[0];
    const upcomingRes = await fetch(
      `https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/${today}/inverse`,
      { headers: HEADERS }
    );
    const upcomingData = await upcomingRes.json();
    const allToday = upcomingData.events || [];

    // Filter only upcoming (not started)
    const upcoming = allToday
      .filter(e => e.status?.type === 'notstarted')
      .slice(0, 5)
      .map(e => ({
        id:       e.id,
        sport:    'football',
        league:   e.tournament?.name || e.tournament?.uniqueTournament?.name || '–',
        home:     e.homeTeam?.name || '–',
        away:     e.awayTeam?.name || '–',
        homeLogo: e.homeTeam?.id ? `https://api.sofascore.app/api/v1/team/${e.homeTeam.id}/image` : null,
        awayLogo: e.awayTeam?.id ? `https://api.sofascore.app/api/v1/team/${e.awayTeam.id}/image` : null,
        time:     e.startTimestamp
          ? new Date(e.startTimestamp * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          : '–'
      }));

    // 3. No live events at all
    if (!liveEvent) {
      return res.status(200).json({
        match: null,
        message: 'Sin partidos en vivo',
        upcoming,
        totalLive: 0
      });
    }

    const e = liveEvent.event;
    const homeTeam = e.homeTeam || {};
    const awayTeam = e.awayTeam || {};
    const homeScore = e.homeScore || {};
    const awayScore = e.awayScore || {};
    const status = e.status || {};
    const tournament = e.tournament || {};

    res.status(200).json({
      match: {
        id:         e.id,
        sport:      liveEvent.sport,
        league:     tournament.name || tournament.uniqueTournament?.name || '–',
        leagueLogo: tournament.uniqueTournament?.id
          ? `https://api.sofascore.app/api/v1/unique-tournament/${tournament.uniqueTournament.id}/image`
          : null,
        minute:     status.description || null,
        status:     status.type || '–',
        statusLong: status.description || status.type || '–',
        isLive:     status.type === 'inprogress',
        home: {
          name:  homeTeam.name || homeTeam.shortName || '–',
          logo:  homeTeam.id ? `https://api.sofascore.app/api/v1/team/${homeTeam.id}/image` : null,
          score: homeScore.current ?? homeScore.display ?? 0,
        },
        away: {
          name:  awayTeam.name || awayTeam.shortName || '–',
          logo:  awayTeam.id ? `https://api.sofascore.app/api/v1/team/${awayTeam.id}/image` : null,
          score: awayScore.current ?? awayScore.display ?? 0,
        },
        stats: {
          possessionHome: null, possessionAway: null,
          shotsHome: null,      shotsAway: null,
          foulsHome: null,      foulsAway: null,
          cornersHome: null,    cornersAway: null,
          yellowHome: null,     yellowAway: null,
        },
        updated: new Date().toISOString()
      },
      totalLive,
      upcoming
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
