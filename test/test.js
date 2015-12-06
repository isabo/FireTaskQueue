var Firebase = require('firebase');

var util = require('./util');
var basic = require('./basic');
var storesErrors = require('./stores-errors.js');

// Run the tests, then wait for Firebase to flush its buffer, then exit, which prompts the test tally.
util.login().
    then(basic.queuesTaskForImmediateProcessing).
    then(basic.queuesTaskForFutureProcessing).
    then(basic.processesTasks).
    then(storesErrors).
    then(function() {
        setTimeout(() => {
            process.exit(0);
        }, 3000);
    }, function(err) {
        process.exit(1);
    });
