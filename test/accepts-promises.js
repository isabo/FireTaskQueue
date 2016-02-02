var util = require('./util');
var FireTaskQueue = require('../src/');


module.exports = function() {

    return Promise.resolve().
        then(acceptsPromises).
        then(handlesRejectedPromises);
};



function acceptsPromises() {

    // Generate a random key to use for the queue, so that we're not using leftovers of previous failed
    // tests.
    var queueKey = 'test-return-promises' + util.ref.push().key();
    var qRef = util.ref.child(queueKey);

    var q = new FireTaskQueue('ReturnPromises', qRef);
    q.scheduleTask({});

    return util.testP('Accepts promise as return value', function(t) {

        // Return a promise so that the test harness will wait for the promise to
        // settle before continuing to the next test or exiting the test session.
        return new Promise(function(resolveTest, rejectTest) {

            // A flag.
            var itFailed = false;

            q.start(function(task) {

                // This should only be entered once, because the task is supposed to succeed.

                if (task.attempts) {
                    // This is a retry. This means the promise returned by the first attempt was not
                    // understood.
                    itFailed = true;
                    t.fail('The task was re-attempted - returning a promise, then resolving it, failed');
                    task.success(); // Use the non-promise way to stop the task.
                    rejectTest(); // Signify to test harness that we failed.
                    return;
                }

                // This is what we're testing: the queue handler should be able to return a promise,
                // which, when fulfilled, terminates the task.
                return new Promise(function(resolveTask, rejectTask) {

                    // If the queue does not understand promises, it may have considered the task
                    // processing to have failed, in which case it would have retried it, thus raising
                    // the itFailed flag.
                    // However, we need to rule out a hung task, i.e. one that was processed, but done()
                    // was not called.
                    setTimeout(function() {
                        if (!itFailed) {

                            // After we resolve the task (see below), it should be deleted from the
                            // database. No other task should be in the queue.
                            util.ref.child('processorCanReturnPromiseQ').on('value', function(snap) {
                                // There should be no data here if the task was processed.
                                t.ok(!snap.exists(), 'No tasks in queue - returning a promise, then resolving it, worked');
                                t.pass('Task has not been retried - must have been treated as succeeded');
                                resolveTest();
                            });

                        }

                        // Tell queue that task has been processed. The queue should then
                        // delete the task from the database.
                        resolveTask();
                    }, 1000);
                });
            });

        }).
        then(() => q.dispose());
    });
}


function handlesRejectedPromises() {

    // Generate a random key to use for the queue, so that we're not using leftovers of previous failed
    // tests.
    var queueKey = 'test-rejected-promises' + util.ref.push().key();
    var qRef = util.ref.child(queueKey);

    var q = new FireTaskQueue('RejectedPromises', qRef);
    q.scheduleTask({});

    return util.testP('Treats a rejected promise as a task failure', function(t) {

        // Return a promise so that the test harness will wait for the promise to
        // settle before continuing to the next test or exiting the test session.
        return new Promise(function(resolveTest, rejectTest) {

            q.start(function(task) {

                // This should be entered twice: once when we fail the task and then a retry.

                if (task.attempts) {
                    // This is a retry. Exactly what we expect.
                    t.pass('The task was re-attempted - returning a promise, then rejecting it, succeeded');
                    task.success(); // Use the non-promise way to stop the task.
                    resolveTest(); // Signify to test harness that we succeeded.
                    return;
                }

                // This is what we're testing: the queue handler should be able to return a promise,
                // which, when fulfilled, terminates the task.
                return new Promise(function(resolveTask, rejectTask) {

                    setTimeout(function() {
                        // Tell queue that task has been processed and it failed. The task should
                        // then be retried later.
                        rejectTask();
                    }, 1000);
                });
            });

        }).
        then(() => q.dispose());
    });
}
