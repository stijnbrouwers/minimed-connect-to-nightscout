/* jshint node: true */
"use strict";

module.exports = (function() {
  var verbose_ = false;
  var debug_ = false;

  return {
    setVerbose: function(v) {
      verbose_ = v;
    },
    setDebug: function(d) {
      debug_ = d;
    },
    verbose: function(str) {
      if(verbose_) {
        console.log(new Date(), arguments); 
      }
    },
    log: function(str) {
      console.log(new Date(), arguments);
    },
    debug: function(str) {
      if(debug_) {
        console.log(new Date(), arguments); 
      }
    },
    error: function(str) {
      console.error(new Date(), str)
    }
  };
})();
