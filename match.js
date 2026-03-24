export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const key = process.env.RAPIDAPI_KEY;

  // Check key exists
  if (!key) {
    return res.status(500).json({
      error: 'RAPIDAPI_KEY no configurada en Vercel Environment Variables'
    });
  }

  try {
    // Try live matches first
    let response = await fetch('https://api-football-v1.p.rapidapi.com/v3/fixtures?live=all', {
      headers: {
        'x-rapidapi-key': key,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
      }
    });

    const data = await response.json();

    // API error check
    if (data.errors && Object.keys(data.errors).length > 0) {
      return res.status(500).json({ error: JSON.stringify(data.errors) });
    }

    let fixtures = data.response || [];

    // No live matches right now — get today's matches as fallback
    if (fixtures.length === 0) {
      const today = new Date().toISOString().split('T')[0];
      response = await fetch(`https://api-football-v1.p.rapidapi.com/v3/fixtures?date=${today}`, {
        headers: {
          'x-rapidapi-key': key,
          'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
        }
      });
      const todayData = await response.json();
      fixtures = todayData.response || [];
    }

    if (fixtures.length === 0) {
      return res.status(200).json({ match: null, message: 'Sin partidos hoy' });
    }

    // Pick best match: prefer live, then most recently started
    const live = fixtures.filter(f =>
      ['1H','2H','HT','ET','P'].includes(f.fixture.status.short)
    );
    const f = live.length > 0 ? live[0] : fixtures[0];

    const homeSt = (f.statistics || [])[0]?.statistics || [];
    const awaySt = (f.statistics || [])[1]?.statistics || [];
    const statVal = (arr, type) => {
      const found = arr.find(s => s.type === type);
      return found ? found.value : null;
    };

    const match = {
      id:         f.fixture.id,
      league:     f.league.name,
      leagueLogo: f.league.logo,
      minute:     f.fixture.status.elapsed,
      status:     f.fixture.status.short,
      statusLong: f.fixture.status.long,
      isLive:     live.length > 0,
      home: {
        name:  f.teams.home.name,
        logo:  f.teams.home.logo,
        score: f.goals.home ?? 0,
      },
      away: {
        name:  f.teams.away.name,
        logo:  f.teams.away.logo,
        score: f.goals.away ?? 0,
      },
      stats: {
        possessionHome: statVal(homeSt, 'Ball Possession'),
        possessionAway: statVal(awaySt, 'Ball Possession'),
        shotsHome:      statVal(homeSt, 'Shots on Goal'),
        shotsAway:      statVal(awaySt, 'Shots on Goal'),
        foulsHome:      statVal(homeSt, 'Fouls'),
        foulsAway:      statVal(awaySt, 'Fouls'),
        cornersHome:    statVal(homeSt, 'Corner Kicks'),
        cornersAway:    statVal(awaySt, 'Corner Kicks'),
        yellowHome:     statVal(homeSt, 'Yellow Cards'),
        yellowAway:     statVal(awaySt, 'Yellow Cards'),
      },
      updated: new Date().toISOString()
    };

    res.status(200).json({ match });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
