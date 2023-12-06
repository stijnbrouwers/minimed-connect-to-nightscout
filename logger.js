/* jshint node: true */
"use strict";

module.exports = (function() {
  var verbose_ = false;

  return {
    setVerbose: function(v) {
      verbose_ = v;
    },
    verbose: function(str) {
      if(verbose_) {
        console.log(new Date(), arguments); 
      }
    },
    log: function(str) {
      console.log(new Date(), arguments);
    }
  };
})();
