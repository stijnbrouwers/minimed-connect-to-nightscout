/* jshint node: true */
"use strict";

var carelink = require('./carelink'),
  filter = require('./filter'),
  logger = require('./logger'),
  nightscout = require('./nightscout'),
  transform = require('./transform');

function readEnv(key, defaultVal) {
  var val = process.env[key] ||
    process.env[key.toLowerCase()] ||
    // Azure prefixes environment variables with this
    process.env['CUSTOMCONNSTR_' + key] ||
    process.env['CUSTOMCONNSTR_' + key.toLowerCase()];

  if (val === 'true') val = true;
  if (val === 'false') val = false;
  if (val === 'null') val = null;

  return val !== undefined ? val : defaultVal;
}

var config = {
  username: readEnv('CARELINK_USERNAME'),
  password: readEnv('CARELINK_PASSWORD'),
  nsHost: readEnv('WEBSITE_HOSTNAME'),
  nsBaseUrl: readEnv('NS'),
  nsSecret: readEnv('API_SECRET'),
  interval: parseInt(readEnv('CARELINK_REQUEST_INTERVAL', 60 * 1000), 10),
  sgvLimit: parseInt(readEnv('CARELINK_SGV_LIMIT', 24), 10),
  treatmentLimit: parseInt(readEnv('CARELINK_TREATMENT_LIMIT', 24), 10),
  bgCheckLimit: parseInt(readEnv('CARELINK_BG_CHECK_LIMIT', 24), 10),
  maxRetryDuration: parseInt(readEnv('CARELINK_MAX_RETRY_DURATION', carelink.defaultMaxRetryDuration), 10),
  verbose: !readEnv('CARELINK_QUIET', true),
  deviceInterval: 5.1 * 60 * 1000,
  patientId: readEnv('CARELINK_PATIENT'),
  maxNightscoutDiff: 270
};

if (!config.username) {
  throw new Error('Missing CareLink username');
} else if(!config.password) {
  throw new Error('Missing CareLink password');
}

var client = carelink.Client({
  username: config.username,
  password: config.password,
  maxRetryDuration: config.maxRetryDuration,
  patientId: config.patientId
});
var entriesUrl = (config.nsBaseUrl ? config.nsBaseUrl : 'https://' + config.nsHost) + '/api/v1/entries.json';
var devicestatusUrl = (config.nsBaseUrl ? config.nsBaseUrl : 'https://' + config.nsHost) + '/api/v1/devicestatus.json';
var treatmentsUrl = (config.nsBaseUrl ? config.nsBaseUrl : 'https://' + config.nsHost) + '/api/v1/treatments.json';

logger.setVerbose(config.verbose);

var filterSgvs = filter.makeRecencyFilter(function(item) {
  return item['date'];
});

var filterDeviceStatus = filter.makeRecencyFilter(function(item) {
  return new Date(item['created_at']).getTime();
});

var filterTreatments = filter.makeRecencyFilter(function(item) {
  return new Date(item['created_at']).getTime();
});

var filterbgCheckEntries = filter.makeRecencyFilter(function(item) {
  return new Date(item['created_at']).getTime();
});

function uploadMaybe(items, endpoint, callback) {
  if (items.length === 0) {
    logger.log('No new items for ' + endpoint);
    callback();
  } else {
    nightscout.upload(items, endpoint, config.nsSecret, function(err, response) {
      if (err) {
        // Continue gathering data from CareLink even if Nightscout can't be reached
        console.log(err);
      }
      callback();
    });
  }
}

function getMatchingNightscoutSgv(minimedSgv,nightscoutSgvs) {
  var out = [];

  nightscoutSgvs.forEach(nightscoutSgv => {
    if(nightscoutSgv.sgv === minimedSgv.sgv) {
      var timeDiff = nightscoutSgv.date - minimedSgv.date;
      if(timeDiff >= 0 && timeDiff <= config.maxNightscoutDiff*1000) {
        out.push(nightscoutSgv);
      }
    }
  });

  return out;
}

function filterMissingSgvs(minimedSgvs,nightscoutSgvs) {
  var out = [];

  var matchCount = 0;
  var totalTimeDiff = 0;
  minimedSgvs.forEach(minimedSgv => {

    var matchingNightscoutSgvs = getMatchingNightscoutSgv(minimedSgv,nightscoutSgvs);
    if(matchingNightscoutSgvs.length === 0) {
      out.push(minimedSgv);
    } else if (matchingNightscoutSgvs.length > 1) {
      console.error(`Something went wrong: More than 1 matching nightscout entry was returned for ${minimedSgv.sgv} @ ${new Date(minimedSgv.date).toLocaleString()}`);
      matchingNightscoutSgvs.forEach(matchingNightscoutSgv => {
        console.error(`\tNS match = ${matchingNightscoutSgv.sgv} @ ${new Date(matchingNightscoutSgv.date)}`)
      });
    } else {
      var matchingNightscoutSgv = matchingNightscoutSgvs[0];
      if(matchingNightscoutSgv.device === "Leonneke &lt;3") {
        matchCount++;
        totalTimeDiff += matchingNightscoutSgv.date - minimedSgv.date;
      }
    }
  });

  if(matchCount < 5) {
    console.log(`Not enough nightscout entries found, not uploading anything`);
    return [];
  }

  let averageTimeDiff = Math.round(totalTimeDiff/matchCount);
  console.log(`average time diff: ${averageTimeDiff}`);
  out.forEach(svg => {
    let dateBefore = svg.date;
    svg.date += averageTimeDiff;
    //console.warn(`> Adding ${svg.sgv} @ ${new Date(dateBefore).toLocaleString()} =>${new Date(svg.date).toLocaleString()}`);
  });

  return out;
}

function requestLoop() {
  try {
    client.fetch(function(err, data) {
      if (err) {
        console.log(err);
        setTimeout(requestLoop, config.deviceInterval);
      } else {
        let transformed = transform(data, config.sgvLimit, config.treatmentLimit, config.bgCheckLimit);

        nightscout.get(entriesUrl+'?count='+(config.sgvLimit+5),config.nsSecret,function(err, response) {
          const nightscoutSgvs = response.body;

          let missingSgvs = filterMissingSgvs(transformed.entries,nightscoutSgvs);
          // Because of Nightscout's upsert semantics and the fact that CareLink provides trend
          // data only for the most recent sgv, we need to filter out sgvs we've already sent.
          // Otherwise we'll overwrite existing sgv entries and remove their trend data.
          let newSgvs = filterSgvs(missingSgvs);

          // Nightscout's entries collection upserts based on date, but the devicestatus collection
          // does not do the same for created_at, so we need to de-dupe them here.
          let newDeviceStatuses = filterDeviceStatus(transformed.devicestatus);
          if(newDeviceStatuses && newDeviceStatuses.length > 0 && newDeviceStatuses[0].created_at) {
            newDeviceStatuses[0].pump = {
              reservoir: data.reservoirRemainingUnits,
              status: {
                status: ' - MaxAutoBasal=' +data.maxAutoBasalRate
              }
            }
          }
          let newTreatments = filterTreatments(transformed.treatments);

          let newbgCheckEntries = filterbgCheckEntries(transformed.bgCheckEntries);

          // Calculate interval by the device next upload time
          let interval = config.deviceInterval - (data.currentServerTime - data.lastMedicalDeviceDataUpdateServerTime);
          if (interval > config.deviceInterval || interval < 0)
            interval = config.deviceInterval;

          uploadMaybe(newSgvs, entriesUrl, function() {
            uploadMaybe(newDeviceStatuses, devicestatusUrl, function() {
              uploadMaybe(newTreatments, treatmentsUrl, function() {
                uploadMaybe(newbgCheckEntries, treatmentsUrl, function() {
                  setTimeout(requestLoop, interval);
                });
              });
            });
          });
        });
      }
    })
  } catch (error) {
    console.error(error);
    setTimeout(requestLoop, config.deviceInterval);
  }
}

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

// Safety function to avoid ban for managed environments (it only happens once, on the start)
let waitTime = 0;
if (process.env.RANDOMIZE_INIT) { waitTime = getRandomInt(3 * 60 * 1000); }
console.log(`[MMConnect] Wait ${Math.round(waitTime / 1000)} seconds before start`);
setTimeout(requestLoop, waitTime);
