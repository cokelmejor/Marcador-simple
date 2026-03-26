export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const KEY = process.env.RAPIDAPI_KEY;
  if (!KEY) return res.status(500).json({ error: 'API key no configurada' });

  const headers = {
    'x-rapidapi-key': KEY,
    'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
  };

  try {
    // --- 1. Fetch live fixtures ---
    const liveRes = await fetch('https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all', { headers });
    const liveData = await liveRes.json();
    const liveFixtures = liveData.response || [];

    if (liveFixtures.length > 0) {
      // Take first live match
      const fixture = liveFixtures[0];
      const fixtureId = fixture.fixture.id;

      // --- 2. Fetch events for scorers, cards, VAR ---
      const eventsRes = await fetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/events?fixture=${fixtureId}`, { headers });
      const eventsData = await eventsRes.json();
      const events = eventsData.response || [];

      // --- 3. Fetch stats ---
      const statsRes = await fetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${fixtureId}`, { headers });
      const statsData = await statsRes.json();
      const statsArr = statsData.response || [];

      const getStatVal = (team, type) => {
        const t = statsArr.find(s => s.team.id === team);
        if (!t) return null;
        const st = t.statistics.find(s => s.type === type);
        return st ? st.value : null;
      };

      const homeId = fixture.teams.home.id;
      const awayId = fixture.teams.away.id;

      // --- 4. Parse events ---
      const goals = events.filter(e => e.type === 'Goal' && e.detail !== 'Missed Penalty');
      const yellowCards = events.filter(e => e.type === 'Card' && e.detail === 'Yellow Card');
      const redCards = events.filter(e => e.type === 'Card' && (e.detail === 'Red Card' || e.detail === 'Yellow Red Card'));
      const varEvents = events.filter(e => e.type === 'Var');

      // Check if VAR review is currently active (last event is a VAR challenge not yet resolved)
      const lastEvent = events[events.length - 1];
      const varActive = lastEvent && lastEvent.type === 'Var' &&
        (lastEvent.detail === 'Goal cancelled' ? false : lastEvent.detail.includes('VAR') || lastEvent.detail.includes('Challenge'));

      // --- 5. Added time detection ---
      const elapsed = fixture.fixture.status.elapsed || 0;
      const extra = fixture.fixture.status.extra || null;
      const statusShort = fixture.fixture.status.short;

      // Detect added time phase
      let addedTime = null;
      if (statusShort === '1H' && elapsed >= 45) {
        addedTime = extra || (elapsed - 45);
      } else if (statusShort === '2H' && elapsed >= 90) {
        addedTime = extra || (elapsed - 90);
      }

      // Format minute display
      let minuteDisplay;
      if (addedTime !== null && addedTime > 0) {
        const base = statusShort === '1H' ? 45 : 90;
        minuteDisplay = `${base}+${addedTime}'`;
      } else {
        minuteDisplay = elapsed ? `${elapsed}'` : null;
      }

      // --- 6. Format scorers ---
      const formatGoals = (teamId) =>
        goals
          .filter(e => e.team.id === teamId)
          .map(e => ({
            player: e.player?.name || 'Desconocido',
            minute: e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : ''),
            type: e.detail === 'Own Goal' ? 'og' : e.detail === 'Penalty' ? 'pen' : 'goal'
          }));

      const formatYellows = (teamId) =>
        yellowCards
          .filter(e => e.team.id === teamId)
          .map(e => ({
            player: e.player?.name || 'Desconocido',
            minute: e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : '')
          }));

      // --- 7. VAR review status ---
      const currentVarReview = varActive && lastEvent ? {
        detail: lastEvent.detail,
        team: lastEvent.team?.name
      } : null;

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
          addedTime: addedTime,
          updated: fixture.fixture.date,
          home: {
            id: homeId,
            name: fixture.teams.home.name,
            logo: fixture.teams.home.logo,
            score: fixture.goals.home ?? 0,
            goals: formatGoals(homeId),
            yellowCards: formatYellows(homeId)
          },
          away: {
            id: awayId,
            name: fixture.teams.away.name,
            logo: fixture.teams.away.logo,
            score: fixture.goals.away ?? 0,
            goals: formatGoals(awayId),
            yellowCards: formatYellows(awayId)
          },
          varReview: currentVarReview,
          stats: {
            possessionHome: getStatVal(homeId, 'Ball Possession'),
            possessionAway: getStatVal(awayId, 'Ball Possession'),
            shotsHome: getStatVal(homeId, 'Shots on Goal'),
            shotsAway: getStatVal(awayId, 'Shots on Goal'),
            foulsHome: getStatVal(homeId, 'Fouls'),
            foulsAway: getStatVal(awayId, 'Fouls'),
            cornersHome: getStatVal(homeId, 'Corner Kicks'),
            cornersAway: getStatVal(awayId, 'Corner Kicks'),
            yellowHome: getStatVal(homeId, 'Yellow Cards'),
            yellowAway: getStatVal(awayId, 'Yellow Cards')
          }
        },
        totalLive: liveFixtures.length
      });
    }

    // --- No live matches: fetch upcoming grouped by competition ---
    const todayStr = new Date().toISOString().split('T')[0];
    const upcomingRes = await fetch(
      `https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${todayStr}&status=NS`,
      { headers }
    );
    const upcomingData = await upcomingRes.json();
    const upcomingRaw = (upcomingData.response || [])
      .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);

    // Group by competition
    const grouped = {};
    for (const u of upcomingRaw) {
      const leagueKey = `${u.league.country} — ${u.league.name}`;
      if (!grouped[leagueKey]) grouped[leagueKey] = { logo: u.league.logo, matches: [] };
      grouped[leagueKey].matches.push({
        home: u.teams.home.name,
        homeLogo: u.teams.home.logo,
        away: u.teams.away.name,
        awayLogo: u.teams.away.logo,
        timestamp: u.fixture.timestamp,
        time: new Date(u.fixture.timestamp * 1000).toLocaleTimeString('es-ES', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
        })
      });
    }

    return res.json({ match: null, upcoming: grouped });

  } catch (e) {
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
