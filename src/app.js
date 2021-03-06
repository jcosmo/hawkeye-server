const express = require('express');
const request = require('request');
const cheerio = require('cheerio');
const app = express();

// Set to true to use a local copy of the nsnta site that is expected to be found in the public dir of the hawkeye app
const LOCAL_NSNTA_CLONE = true;
// Set to true to just try to parse all the data from the nsnta site rather than fire up a server
const SCRAPE_ONLY = false;
const DEBUG = false;

const GRADE_NAME_MATCH = function (i, elem) {
  return aa(elem).children().length === 0 && aa(elem).text().match(/^\s*[A-D] GRADE|RESERVE|SPECIAL( [1-9])?\s*$/);
};
const ROUND_NAME_MATCH = function (i, elem) {
  return aa(elem).children().length === 0 && aa(elem).text().match(/^\s*Round 1\s*$/);
};
const ROUND_LINK_MATCH = function (i, elem) {
  return aa(elem).text().match(/Round /);
};
const TOTAL_SCORE_MATCH = function (i, elem) {
  return aa(elem).text().match(/Total/);
};

if (LOCAL_NSNTA_CLONE) {
  NSNTA_GROUP = 'mens'; //'ladies', 'mixed'
  NSNTA_GROUP_CAMEL = 'Mens'; //'ladies', 'mixed'
  FIXTURE_URL = `http://localhost:8088/fixtures${NSNTA_GROUP}.html`;
  LADDER_URL = `http://localhost:8088/ladder${NSNTA_GROUP}.html`;
  MATCHES_FOR_GRADE_URL = `http://localhost:8088/results/${NSNTA_GROUP_CAMEL}/GRADE/index.php`;
} else {
  NSNTA_GROUP = 'mens'; //'ladies', 'mixed'
  NSNTA_GROUP_CAMEL = 'Mens'; //'ladies', 'mixed'
  FIXTURE_URL = `http://nsnta.org/fixtures${NSNTA_GROUP}.html`;
  LADDER_URL = `http://nsnta.org/ladder${NSNTA_GROUP}.html`;
  MATCHES_FOR_GRADE_URL = `http://nsnta.org/results/${NSNTA_GROUP_CAMEL}/GRADE/index.php`;
}

let clubs = [];
let grades = [];
let teams = [];
let fixture = {};
let ladders = [];
let matches = [];
let aa;
let scraped;
let outstanding_requests = 0;

function reset() {
  grades = [];
  clubs = [];
  teams = [];
  fixture = {};
  ladders = [];
  scraped = undefined;
}

function extractGrades(firstGradesContainer) {
  // Get the grade names from the container, then get all the clubs from siblings until we reach a blank row.
  // After a blank row keep looking until we find another block of grades, then repeat.
  const gradesOnRow = [];
  aa(firstGradesContainer).children().filter(GRADE_NAME_MATCH).each(function (i, elem) {
    const gradeName = aa(this).text().trim();

    const grade = {id: grades.length, letter: '', category: '', level: 0, fullName: gradeName};
    const match = gradeName.match(/([A-D]) (GRADE|RESERVE|SPECIAL)( [1-9])?/);
    grade.letter = match[1];
    grade.category = match[2];
    if (match.length > 3 && match[3]) {
      grade.level = parseInt(match[3].trim(), 10)
    }

    if (SCRAPE_ONLY && DEBUG) {
      console.log(`Found Grade ${grade.fullName} as id ${grade.id}`);
    }
    grades.push(grade);
    gradesOnRow.push(grade);
  });

  // Process all the rows about the clubs in each grade.
  firstGradesContainer = firstGradesContainer.next();
  let nextTeamNumber = 1;
  while (firstGradesContainer && firstGradesContainer.children().first().text().trim() === `${nextTeamNumber}`) {
    // Get all clubs of this number
    firstGradesContainer.children().filter((i, e) => i % 2 === 1 && i / 2 <= gradesOnRow.length).each(
        (i, e) => {
          let teamName = aa(e).text().trim();
          let clubName;
          if (teamName.match(/.*Bye.*/)) {
            clubName = 'Bye';
            teamName = undefined;
          }
          else if (match = teamName.match((/^([^\(]+)\(([^\)]+)\)$/))) {
            clubName = match[1].trim();
            teamName = match[2].trim();
          } else {
            clubName = teamName;
            teamName = undefined;
          }
          let club = clubs.find(c => c.name === clubName);
          if (!club) {
            club = {id: clubs.length, name: clubName};
            if (SCRAPE_ONLY && DEBUG) {
              console.log(`Found new club ${club.name} as id ${club.id}`);
            }
            clubs.push(club);
          }
          let team = {
            id: teams.length,
            clubId: club.id,
            gradeId: gradesOnRow[i].id,
            fixtureNumber: nextTeamNumber,
            name: teamName
          };
          if (SCRAPE_ONLY && DEBUG) {
            console.log(`Added team ${team.name} to club ${club.name} as id ${team.id}`)
          }
          teams.push(team);
        });
    nextTeamNumber++;
    firstGradesContainer = firstGradesContainer.next();
  }

  // Skip to the next set of grades
  while (firstGradesContainer.children().length > 0 && firstGradesContainer.children().filter(GRADE_NAME_MATCH).length === 0) {
    firstGradesContainer = firstGradesContainer.next();
  }

  if (firstGradesContainer.children().filter(GRADE_NAME_MATCH).length > 0) {
    extractGrades(firstGradesContainer);
  }
}

function teamMatchesName(team, name, recurse = true) {
  // Club name match and possible 'teamname' match
  const club = clubs[team.clubId];
  if (club.name === name) {
    return true;
  }
  if (!team.name && club.name.indexOf(name) === 0) {
    return true;
  }
  if (team.name && name.indexOf(club.name) === 0 && name.indexOf(team.name) > 0) {
    return true;
  }
  if (!recurse) {
    return false;
  }
  // and now for magic shit just to handle crappy NSNTA content:
  return teamMatchesName(team, name.replace(/St/, 'St.'), false) ||
      teamMatchesName(team, name.replace(/Mt\./, 'Mt'), false) ||
      teamMatchesName(team, name.replace(/St\./, 'St'), false) ||
      teamMatchesName(team, name.replace(/\d$/, '').trim(), false);
}

function findTeam(gradeId, name) {
  return teams.find(t => t.gradeId === gradeId && teamMatchesName(t, name));
}

/*
{
  round:
  gradeId:
  teams: [
    {
      teamId:
      points:
      percentage:
    }
  ]
 */
function extractLadders(firstLadderContainer) {
  // Get the grade names from the container, then get all the clubs from siblings until we reach a blank row.
  // After a blank row keep looking until we find another block of grades, then repeat.
  const laddersOnRow = [];

  aa(firstLadderContainer).children().filter(GRADE_NAME_MATCH).each(function (i, elem) {
    const gradeName = aa(this).text().trim();
    const round = aa(this).next().text().trim().slice(1);
    const ladder = {id: ladders.length, gradeId: -1, round: parseInt(round, 10), teams: []};
    ladder.gradeId = grades.find(g => (g.fullName === gradeName )).id;
    laddersOnRow.push(ladder);
    ladders.push(ladder)
  });


  // Process all the rows about the ladder in each grade.
  let offset = 0;
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((i) => {
    firstLadderContainer = firstLadderContainer.next();
    let index = 0;
    laddersOnRow.forEach(ladder => {
      const team = {teamId: -1, points: 0, percentage: 0, won: 0, lost: 0};
      const name = firstLadderContainer.children().eq(index * 6 + offset).text().trim();
      const match = findTeam(ladder.gradeId, name);
      if (match) {
        if (SCRAPE_ONLY && DEBUG) {
          console.log(`Matched ${name} in ladder ${ladder.id}`);
        }
        team.teamId = match.id;
      }
      else {
        console.log(`ERROR: Failed to match ${name} in ladder ${ladder.id}`);
        team.unmatched = name;
      }
      team.points = parseInt(firstLadderContainer.children().eq(index * 6 + 1 + offset).text().trim(), 10);
      team.won = parseInt(firstLadderContainer.children().eq(index * 6 + 2 + offset).text().trim(), 10);
      team.lost = parseInt(firstLadderContainer.children().eq(index * 6 + 3 + offset).text().trim(), 10);
      team.percentage = parseInt(firstLadderContainer.children().eq(index * 6 + 4 + offset).text().trim(), 10);
      ladder.teams.push(team);
      index = index + 1;
    })
  });

  // Skip to the next set of grades
  while (firstLadderContainer.children().length > 0 && firstLadderContainer.children().filter(GRADE_NAME_MATCH).length === 0) {
    firstLadderContainer = firstLadderContainer.next();
  }

  if (firstLadderContainer.children().filter(GRADE_NAME_MATCH).length > 0) {
    extractLadders(firstLadderContainer);
  }
}

function extractFixture(row) {
  /*
    load() {
    let json = {
      rounds: [
        {number: 1, date: '08 Feb 2018', schedule:{1:8,3:6,5:4,7:2}},
        {number: 2, date: '15 Feb 2018', schedule:{2:5,4:3,6:1,8:7}},
        {number: 3, date: '22 Feb 2018', schedule:{1:4,3:2,5:7,8:6}},
        {number: 4, date: '01 Mar 2018', schedule:{1:4,3:2,5:7,8:6}},
      ]
    };
   */
  let month;
  let done = false;
  let rounds = [];
  while (!done) {
    let columns = row.children();
    let match = columns.first().text().match(/\s*Round (\d+)\s*/);
    if (match) {
      let round = parseInt(match[1], 10);
      if (columns.eq(1).text().trim().length > 0) {
        month = columns.eq(1).text().trim();
      }
      let day = columns.eq(2).text().trim();
      let date = `${day} ${month}`;
      let schedule = {};
      let bad = false;
      [0, 1, 2, 3].forEach(i => {
        const home = parseInt(columns.eq(3 + (i * 3)).text().trim(), 10);
        const away = parseInt(columns.eq(3 + (i * 3) + 2).text().trim(), 10);
        if (!home) {
          bad = true;
        }
        schedule[home] = away;
      });
      if (!bad) {
        rounds.push({number: round, date: date, schedule: schedule})
      }
    }
    row = row.next();
    if (row.children().length <= 0) {
      done = true;
    }
  }
  fixture.rounds = rounds;
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function handleScrapeCompletion(res) {
  outstanding_requests = outstanding_requests - 1;
  if (outstanding_requests <= 0) {
    scraped = {
      ladders: ladders,
      fixture: fixture,
      clubs: clubs,
      grades: grades,
      teams: teams,
      matches: matches
    };

    if (res) {
      res.status(200).send(scraped).end();
    }
    else {
      console.log("All requests closed");
    }
  }
}

function scrapeMatch(req, res, grade, href, match) {
  /*
    updateFromJson(json) {
    this.round = this.matchStore.rootStore.fixtureStore.fixture.round(json.roundNumber);
    this.homeTeam = this.matchStore.rootStore.teamStore.resolve(json.homeTeamId);
    this.awayTeam = this.matchStore.rootStore.teamStore.resolve(json.awayTeamId);
    this.homeScore = json.homeScore;
    this.awayScore = json.awayScore;
  }
  */
  request(href, (error, response, html) => {
    if (!error) {
      aa = cheerio.load(html);

      totalTdNode = aa('td').filter(TOTAL_SCORE_MATCH).first();
      if (totalTdNode) {
        match.homeScore = parseInt(totalTdNode.next('td').text(), 10);
        match.awayScore = parseInt(totalTdNode.next('td').next('td').text(), 10);
      }

      match.id = matches.length;
      matches.push(match);
    } else {
      console.log(`ERROR: Failed to load match from ${href}`);
    }

    handleScrapeCompletion(res);
  });
}

function extractMatches(req, res, baseUrl, grade, firstRoundContainer) {
  let links = aa(firstRoundContainer).children().filter(ROUND_LINK_MATCH);
  outstanding_requests = outstanding_requests + links.length;
  links.each(function (i, elem) {
    let href = baseUrl + "/" + aa(this).attr('href');
    const linkName = aa(this).text().trim();
    const match = linkName.match(/Round ([0-9]+) - (.*) vs (.*)\.html/);
    const roundNumber = parseInt(match[1].trim(), 10);

    if (SCRAPE_ONLY && DEBUG) {
      console.log(`Grade ${grade.fullName} - Round ${roundNumber} at href ${href}: ${match[2]} vs ${match[3]} via text ${linkName}`);
    }

    let homeTeam = findTeam(grade.id, match[2]);
    if (!homeTeam) {
      console.log(`ERROR: Failed to determine home team for match ${match[2]} in grade ${grade.fullName}`);
      handleScrapeCompletion(res);
      return;
    }
    let awayTeam = findTeam(grade.id, match[3]);
    if (!awayTeam) {
      console.log(`ERROR: Failed to determine away team for match ${match[2]} in grade ${grade.fullName}`);
      handleScrapeCompletion(res);
      return;
    }
    scrapeMatch(req, res, grade, href,
        {
          id: -1,
          roundNumber: roundNumber,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          homeScore: 0,
          awayScore: 0
        });
  });
}

function scrapeMatches(req, res) {
  console.log(`Loading matches`);

  outstanding_requests = grades.length;

  grades.forEach(g => {
    const gradeMatchUrl = MATCHES_FOR_GRADE_URL.replace(/GRADE/, toTitleCase(g.fullName).replace(/ /g, '%20'));
    const baseUrlForIndividualMatches = gradeMatchUrl.replace(/\/[^/]*$/, '');
    if (SCRAPE_ONLY) {
      console.log(`Loading results for ${g.fullName} from ${gradeMatchUrl}`);
    }

    request(gradeMatchUrl, (error, response, html) => {
      if (!error) {
        aa = cheerio.load(html);
        const firstRoundsContainer = aa("a").filter(ROUND_LINK_MATCH);
        if (firstRoundsContainer) {
          extractMatches(req, res, baseUrlForIndividualMatches, g, firstRoundsContainer.first().parent());
        }
      } else {
        console.log("ERROR: Had an error matches for grade url");
      }
      handleScrapeCompletion(res);
    });
  });
}

function scrapeLadders(req, res) {
  const ladderUrl = LADDER_URL;
  console.log(`Loading ladders from ${ladderUrl}`);
  request(ladderUrl, (error, response, html) => {
    if (!error) {
      aa = cheerio.load(html);
      const firstLaddersContainer = aa("div table tr td table tr td table tr td").filter(GRADE_NAME_MATCH).first().parent();
      extractLadders(firstLaddersContainer);

      scrapeMatches(req, res);
    } else {
      console.log("ERROR: Had an error loading ladder url");
    }
  });
}

function scrape(req, res) {
  const url = FIXTURE_URL;
  console.log(`Loading fixture from ${url}`);
  request(url, function (error, response, html) {
        if (!error) {
          aa = cheerio.load(html);
          const firstGradesContainer = aa("div table tr td table tr td table tr td").filter(GRADE_NAME_MATCH).first().parent();
          extractGrades(firstGradesContainer);
          const firstRoundContainer = aa("div table tr td table tr td table tr td").filter(ROUND_NAME_MATCH).first().parent();
          extractFixture(firstRoundContainer);
          if (SCRAPE_ONLY) {
            console.log(`Fixture: ${clubs.length} clubs, ${grades.length} grades, ${teams.length} teams, ${fixture.rounds.length} rounds`);
          }
          scrapeLadders(req, res);
        }
        else {
          console.log("ERROR: Had an error loading fixture url");
        }
      }
  )
}

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get('/', function (req, res) {
  res.status(200).send('Hello, world!').end();
});

app.get('/scrape', function (req, res) {
  if (!scraped) {
    scrape(req, res);
  }
  else {
    res.status(200).send(scraped).end();
  }
});

app.get('/reset', function (req, res) {
  reset();
  res.status(200).send('OK').end();
});

if (LOCAL_NSNTA_CLONE) {
  console.log("Using a local nsnta clone");
  app.use(express.static('nsntaclone'));
}

if (!SCRAPE_ONLY) {
  app.listen('8088');
  console.log('Magic happens on port 8088');
  exports = module.exports = app;
} else {
  scrape(undefined, undefined);
}