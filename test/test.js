var Firebase = require('firebase');

var FireTaskQueue = require('../src/');
var util = require('./util');

var runBasicTests = require('./basic');
var reschedulesTasks = require('./rescheduling');
var storesErrors = require('./stores-errors.js');
var acceptsPromises = require('./accepts-promises.js');

// Run the tests, then wait for Firebase to flush its buffer, then exit, which prompts the test tally.
util.login().
    then(runBasicTests).
    then(reschedulesTasks).
    then(acceptsPromises).
    then(storesErrors).
    then(function() {
        setTimeout(() => {
            FireTaskQueue.disposeAll();
            process.exit(0);
        }, 3000);
    }, function(err) {
        FireTaskQueue.disposeAll();
        process.exit(1);
    });
