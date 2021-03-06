var Firebase = require('firebase');

var FireTaskQueue = require('../src/');
var util = require('./util');

var runBasicTests = require('./basic');
var reschedulesTasks = require('./rescheduling');
var storesErrors = require('./stores-errors');
var acceptsPromises = require('./accepts-promises');
var pipelinesTasks = require('./pipelining');

// Run the tests, then wait for Firebase to flush its buffer, then exit, which prompts the test tally.
util.login().
    then(runBasicTests).
    then(reschedulesTasks).
    then(acceptsPromises).
    then(storesErrors).
    then(pipelinesTasks).
    then(function() {
        setTimeout(() => {
            FireTaskQueue.disposeAll();
            process.exit(0);
        }, 5000);
    }, function(err) {
        FireTaskQueue.disposeAll();
        process.exit(1);
    });
