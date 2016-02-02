var FireTaskQueue = require('../src/');
var util = require('./util');


module.exports = function() {

    return Promise.resolve().
        then(schedulesContinuationTaskSameId).
        then(schedulesContinuationTaskOtherQueue);
};


// Generate a random key to use for the queue, so that we're not using leftovers of previous failed
// tests.
var queueKey = 'test-success-pipelining' + util.ref.push().key();
var qRef = util.ref.child(queueKey);


/**
 * Verify that we can schedule a continuation task with the same ID as the current task.
 */
function schedulesContinuationTaskSameId() {

    return util.testP('Schedules continuation task with same ID', function(t) {

        var q = new FireTaskQueue('PipeliningQueue', qRef);

        var taskId;

        return q.scheduleTask({status: 0}).
            then(function(key) {
                taskId = key;
                t.pass('Task was successfully scheduled');
            }, function(err) {
                t.error(err, 'Failed to schedule task');
                throw err;
            }).
            then(function() {

                return new Promise(function(resolve, reject) {

                    // Work the queue.
                    q.start(function(task) {

                        var firstTaskProcessed = false;

                        switch(task.data.status) {

                            case 0:
                                if (!firstTaskProcessed) {
                                    t.pass('First task was presented for processing');
                                    // Schedule a continuation task.
                                    task.success(undefined, {status: 1}, undefined, task.id);
                                } else {
                                    task.success(); // Delete it.
                                    t.fail('First task was presented AGAIN for processing');
                                    reject();
                                }
                                break;

                            case 1:
                                t.pass('Continuation task was presented for processing');
                                t.equal(task.id, taskId, 'Continuation task has correct ID');
                                task.success();
                                resolve();
                                break;

                            default:
                                t.fail('Incorrect status value - something is wrong');
                                task.success();
                                reject();
                        }
                    });

                });
            }).
            then(function() {
                q.dispose();
            });

        // TODO: verify queue is actually empty at the end!
    });
}


/**
 * Verify that we can schedule a continuation task on another queue.
 */
function schedulesContinuationTaskOtherQueue() {

    var otherQueueKey = 'test-success-pipelining-other' + util.ref.push().key();
    var otherQRef = util.ref.child(otherQueueKey);

    return util.testP('Schedules continuation task on another queue', function(t) {

        var q = new FireTaskQueue('PipeliningQueue', qRef);
        var otherQ = new FireTaskQueue('OtherPipeliningQueue', otherQRef);

        return q.scheduleTask({hello: 'bye'}).
            then(function(key) {
                t.pass('Task was successfully scheduled');
            }, function(err) {
                t.error(err, 'Failed to schedule task');
                throw err;
            }).
            then(function() {

                return new Promise(function(resolve, reject) {

                    var beenHere = false;

                    // Work the queue.
                    q.start(function(task) {

                        if (!beenHere) {
                            t.pass('First task was presented for processing');

                            // Schedule a continuation task.
                            task.success('OtherPipeliningQueue', {status: 1});
                        } else {
                            t.fail('Received another task on first queue!?');
                            task.success();
                            reject();
                        }
                    });

                    otherQ.start(function(task) {

                        t.pass('Continuation task presented on other queue');
                        t.equal(task.data.status, 1, 'Task status is correct.');
                        task.success();
                        resolve();
                    });

                });
            }).
            then(function() {
                q.dispose();
                otherQ.dispose();
            });
    });
}
