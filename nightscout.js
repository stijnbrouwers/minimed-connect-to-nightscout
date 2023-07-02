/* jshint node: true */
"use strict";

var crypto = require('crypto'),
  request = require('request');

var logger = require('./logger');

var upload = module.exports.upload = function(entries, endpoint, secret, callback) {
  logger.log('POST ' + endpoint + ' ' + JSON.stringify(entries));
  request.post(
    endpoint,
    {
      //strictSSL: false,
      body: entries,
      json: true,
      headers: {
        'api-secret': crypto.createHash('sha1').update(secret).digest('hex')
      }
    },
    function(err, response) {
      if(err) {
        callback(new Error("Error uploading to Nightscout: can't connect to Nightscout host"));
      } else if(response.statusCode !== 200) {
        callback(new Error("Error uploading to Nightscout: " + JSON.stringify(response)));
      } else {
        callback(null, response);
      }
    }
  );
};

var getFunction = module.exports.get = function(endpoint, secret, callback) {
  logger.log('GET ' + endpoint);
  request.get(
    endpoint,
    {
      //strictSSL: false,
      json: true,
      headers: {
        'api-secret': crypto.createHash('sha1').update(secret).digest('hex')
      }
    },
    function(err, response) {
      if(err) {
        callback(new Error("Error retrieving from Nightscout: can't connect to Nightscout host"));
      } else if(response.statusCode !== 200) {
        callback(new Error("Error retrieving from Nightscout: " + JSON.stringify(response)));
      } else {
        callback(null, response);
      }
    }
  );
};