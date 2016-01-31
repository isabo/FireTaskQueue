var FireTaskQueue = require('../src/');
var util = require('./util');


module.exports = failedTaskIsReprocessed;


// Generate a random key to use for the queue, so that we're not using leftovers of previous failed
// tests.
var queueKey = 'test-rescheduling' + util.ref.push().key();
var qRef = util.ref.child(queueKey);


function failedTaskIsReprocessed() {

    return util.testP('Failed tasks are rescheduled', function(t) {

        var q = new FireTaskQueue('ReschedulingQueue', qRef);

        var task = {
            name: 'task1'
        }

        return q.scheduleTask(task).
            then(function(key) {
                t.pass('Task was successfully scheduled');
            }, function(err) {
                t.error(err, 'Failed to schedule task');
                throw err;
            }).
            then(function() {

                return new Promise(function(resolve, reject) {

                    q.start(function(task) {

                        // Try different ways of failing.
                        var attempts = 1 + (task.attempts || 0);

                        if (attempts < 5) {
                            t.pass('Task was presented for processing ' + attempts + ' times');
                        }

                        switch (attempts) {
                            case 1:
                                throw new Error('Attempt 1 failed on purpose');

                            case 2:
                                t.pass('Throwing an exception fails the task');
                                t.equal(task.lastFailureReason.message, 'Attempt 1 failed on purpose', 'The exception was serialized correctly');
                                task.fail('Attempt 2 failed on purpose');
                                break;

                            case 3:
                                t.pass('Calling fail() fails the task');
                                t.equal(task.lastFailureReason, 'Attempt 2 failed on purpose', 'The fail() argument was stored correctly');
                                return Promise.reject('Attempt 3 failed on purpose');

                            case 4:
                                t.pass('Returning a rejected promise fails the task');
                                t.equal(task.lastFailureReason, 'Attempt 3 failed on purpose', 'The promise\'s reject() value was stored correctly');
                                task.success();

                                // Finish the test after a delay which gives us a chance to see if the task will be processed any extra times.
                                setTimeout(function(){
                                    resolve();
                                }, 10000);
                                break;

                            default:
                                t.fail('The task was presented for processing an extra time!');
                                reject();
                        }

                    });
                });
            }).
            then(function() {
                q.dispose();
            });

    });
}
