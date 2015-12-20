var util = require('./util');
var FireTaskQueue = require('../src/');

module.exports = {
    acceptsPromises: acceptsPromises,
    handlesRejectedPromises: handlesRejectedPromises
}


function acceptsPromises() {

    var q = new FireTaskQueue('processorCanReturnPromiseQ', util.ref.child('processorCanReturnPromiseQ'));
    q.schedule({});

    return util.testP('Accepts promise as return value', function(t) {

        // Return a promise so that the test harness will wait for the promise to
        // settle before continuing to the next test or exiting the test session.
        return new Promise(function(resolveTest, rejectTest) {

            // A flag.
            var itFailed = false;

            q.monitor(function(id, task, done) {

                // This should only be entered once, because the task is supposed to succeed.

                if (task._attempts) {
                    // This is a retry. This means the promise returned by the first attempt was not
                    // understood.
                    itFailed = true;
                    t.fail('The task was re-attempted - returning a promise, then resolving it, failed');
                    done(); // Use the non-promise way to stop the task.
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

    var q = new FireTaskQueue('rejectedPromises', util.ref.child('rejectedPromises'));
    q.schedule({});

    return util.testP('Treats a rejected promise as a task failure', function(t) {

        // Return a promise so that the test harness will wait for the promise to
        // settle before continuing to the next test or exiting the test session.
        return new Promise(function(resolveTest, rejectTest) {

            q.monitor(function(id, task, done) {

                // This should be entered twice: once when we fail the task and then a retry.

                if (task._attempts) {
                    // This is a retry. Exactly what we expect.
                    t.pass('The task was re-attempted - returning a promise, then rejecting it, succeeded');
                    done(); // Use the non-promise way to stop the task.
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
