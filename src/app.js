const express = require('express');
const request = require('request');
const cheerio = require('cheerio');
const app = express();

const GRADE_NAME_MATCH = function (i, elem) {
  return aa(elem).children().length === 0 && aa(elem).text().match(/^\s*[A-D] GRADE|RESERVE|SPECIAL( [1-9])?\s*$/);
};
const ROUND_NAME_MATCH = function (i, elem) {
  return aa(elem).children().length === 0 && aa(elem).text().match(/^\s*Round 1\s*$/);
};

if (false) {
  FIXTURE_URL = 'http://localhost:3000/nsnta-fixture.html';
  LADDER_URL = 'http://localhost:3000/nsnta-ladder.html';
} else {
  FIXTURE_URL = 'http://nsnta.org/fixturesmens.html';
  LADDER_URL = 'http://nsnta.org/laddermens.html';
}

let clubs = [];
let grades = [];
let teams = [];
let fixture = {};
let ladders = [];
let aa;

function reset() {
  grades = [];
  clubs = [];
  teams = [];
  fixture = {};
  ladders = [];
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
            clubs.push(club);
          }
          let team = {
            id: teams.length,
            clubId: club.id,
            gradeId: gradesOnRow[i].id,
            fixtureNumber: nextTeamNumber,
            name: teamName
          };
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
  [1, 2, 3, 4, 5, 6, 7, 8].forEach((i) => {
    firstLadderContainer = firstLadderContainer.next();
    let index = 0;
    laddersOnRow.forEach(ladder => {
      const team = {teamId: -1, points: 0, percentage: 0, won: 0, lost: 0};
      const name = firstLadderContainer.children().eq(index * 6 + 1).text().trim();
      const match = teams.find(t => t.gradeId === ladder.gradeId && teamMatchesName(t, name));
      if (match) {
        team.teamId = match.id;
      }
      else {
        console.log(`Failed to match ${name} in ladder ${ladder.id}`);
        team.unmatched = name;
      }
      team.points = parseInt(firstLadderContainer.children().eq(index * 6 + 2).text().trim(), 10);
      team.won = parseInt(firstLadderContainer.children().eq(index * 6 + 3).text().trim(), 10);
      team.lost = parseInt(firstLadderContainer.children().eq(index * 6 + 4).text().trim(), 10);
      team.percentage = parseInt(firstLadderContainer.children().eq(index * 6 + 5).text().trim(), 10);
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

function sendResult() {
  let content = {
    fixture: fixture,
    clubs: clubs,
    grades: grades,
    teams: teams
  };

  res.status(200).send(content).end();
}

function scrape(req, res) {
  reset();

  const url = FIXTURE_URL;
  console.log(`Loading fixture from ${url}`);
  request(url, function (error, response, html) {
    if (!error) {
      aa = cheerio.load(html);
      const firstGradesContainer = aa("div table tr td table tr td table tr td").filter(GRADE_NAME_MATCH).first().parent();
      extractGrades(firstGradesContainer);
      const firstRoundContainer = aa("div table tr td table tr td table tr td").filter(ROUND_NAME_MATCH).first().parent();
      extractFixture(firstRoundContainer);
      console.log(`Fixture: ${clubs.length} clubs, ${grades.length} grades, ${teams.length} teams, ${fixture.rounds.length} rounds`);

      const ladderUrl = LADDER_URL;
      console.log(`Loading ladders from ${url}`);
      request(ladderUrl, (error, response, html) => {
        if (!error) {
          aa = cheerio.load(html);
          const firstLaddersContainer = aa("div table tr td table tr td table tr td").filter(GRADE_NAME_MATCH).first().parent();
          extractLadders(firstLaddersContainer);
        }

        let content = {
          ladders: ladders,
          fixture: fixture,
          clubs: clubs,
          grades: grades,
          teams: teams
        };
        if (res) {
          res.status(200).send(content).end();
        }
        else {
          console.log("done");
        }
      });
    }
  });
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
  scrape(req, res);
});


if (true) {
  app.listen('8088');
  console.log('Magic happens on port 8088');
  exports = module.exports = app;
} else {
  scrape(undefined, undefined);
}