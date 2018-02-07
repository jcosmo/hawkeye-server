const express = require('express');
const request = require('request');
const cheerio = require('cheerio');
const app = express();

const GRADE_NAME_MATCH = function (i, elem) {
  return aa(elem).children().length === 0 && aa(elem).text().match(/^\s+[A-D] GRADE|RESERVE|SPECIAL( [1-9])?\s+$/);
};

let clubs = [];
let grades = [];
let teams = [];
let aa;

function reset() {
  grades = [];
  clubs = [];
  teams = [];
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
  nextTeamNumber = 1;
  while (firstGradesContainer && firstGradesContainer.children().first().text().trim() === `${nextTeamNumber}`) {
    // Get all clubs of this number
    firstGradesContainer.children().filter((i, e) => i % 2 === 1 && i / 2 <= gradesOnRow.length).each((i, e) => {
      console.log(`Grade ${gradesOnRow[i].fullName}, Team ${nextTeamNumber}: club ${aa(e).text().trim()}`);
      let teamName = aa(e).text().trim();
      let clubName;
      if (match = teamName.match((/^([^\(]+)\(([^\)]+)\)$/))) {
        clubName = match[1].trim();
        teamName = match[2].trim();
      } else {
        clubName = teamName;
        teamName = undefined;
      }
      club = clubs.find(c => c.name === clubName);
      if (!club) {
        club = {id: clubs.length, name: clubName};
        clubs.push(club);
      }
      let team = {id: teams.length, clubId: club.id, gradeId: 6, fixtureNumber: nextTeamNumber, name: teamName};
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

app.get('/', function (req, res) {
  res.status(200).send('Hello, world!').end();
});

app.get('/scrape', function (req, res) {
  // The URL we will scrape from - in our example Anchorman 2.

  reset();

  const url = 'http://localhost:3000/nsnta-fixture.html';

  console.log(`Loading ${url}`);
  // The structure of our request call
  // The first parameter is our URL
  // The callback function takes 3 parameters, an error, response status code and the html

  request(url, function (error, response, html) {

    // First we'll check to make sure no errors occurred when making the request
    if (!error) {
      // Next, we'll utilize the cheerio library on the returned html which will essentially give us jQuery functionality

      aa = cheerio.load(html);
      const firstGradesContainer = aa("div table tr td table tr td table tr td").filter(GRADE_NAME_MATCH).first().parent();

      extractGrades(firstGradesContainer);
      //gradeNodes.each(extractRowOfGrades);
      /*
            $('.header').filter(function(){
              var data = $(this);
              title = data.children().first().text();

              release = data.children().last().children().text();

              json.release = release;
            })
              */
      let content = {clubs: clubs, grades: grades, teams: teams};
      res.status(200).send(content).end();
    }
    else {
      res.status(200).send('foo').end();
    }
  });
});

app.listen('8088');
console.log('Magic happens on port 8088');
exports = module.exports = app;