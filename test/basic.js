var FireTaskQueue = require('../src/');
var util = require('./util');


module.exports = function() {

    return Promise.resolve().
        then(queuesTaskForImmediateProcessing).
        then(queuesTaskWithID).
        then(failsToQueueTaskWithDuplicateID).
        then(queuesTaskWithDuplicateID).
        then(queuesTaskForFutureProcessing).
        then(processesTasks);
};


// Generate a random key to use for the queue, so that we're not using leftovers of previous failed
// tests.
var queueKey = 'test-basic' + util.ref.push().key();
var qRef = util.ref.child(queueKey);
var q = new FireTaskQueue('BasicTestQueue', qRef);


function queuesTaskForImmediateProcessing() {

    return util.testP('Queues a task for immediate processing', function(t) {

        var task = {
            name: 'task1'
        };

        return q.scheduleTask(task).
            then(function(key) {
                t.pass('Schedule method reports success');

                return util.once(qRef.child(key), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, task.name, 'Returns original data');
                        t.ok(actual._dueAt < Date.now(), 'Has a due date earlier than now');
                    });
            });
    });
}


function queuesTaskWithID() {

    return util.testP('Queues a task with a specified ID', function(t) {

        var id = 'xyz123';

        var task = {
            name: 'task2 original'
        }

        return q.scheduleTask(task, undefined, id).
            then(function(key) {

                t.equal(key, id, 'schedule() returns the specified ID');

                return util.once(qRef.child(id), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, task.name, 'Task was created using the specified ID');
                    });
            });
    });
}


function failsToQueueTaskWithDuplicateID() {

    return util.testP('Fails to queue a task with a duplicate ID', function(t) {

        var id = 'xyz123';

        var task = {
            name: 'task2 duplicate'
        }

        return q.scheduleTask(task, undefined, id).
            then(function(key) {

                t.fail('schedule() reports that the task was queued, but it should have been rejected');

            }, function(err) {

                t.pass('schedule() reports that the task was not queued');
                t.ok(err instanceof FireTaskQueue.DuplicateIdError, 'A DuplicateIdError was returned');
            }).
            then(function() {

                // Verify that the existing task was not updated or overwritten.
                return util.once(qRef.child(id), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, 'task2 original', 'The existing task was not overwritten');
                    });
            });
    });
}


function queuesTaskWithDuplicateID() {

    return util.testP('Queue a task with a duplicate ID, replacing the previous one', function(t) {

        var id = 'xyz123';

        var task = {
            name: 'task2'
        }

        return q.scheduleTask(task, undefined, id, true).
            then(function(key) {

                t.pass('schedule() reports that the task was queued');

            }, function(err) {

                t.fail('schedule() reports that the task was not queued');
            }).
            then(function() {

                // Verify that the existing task was overwritten.
                return util.once(qRef.child(id), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, 'task2', 'The existing task was overwritten');
                    });
            });
    });
}


function queuesTaskForFutureProcessing() {

    return util.testP('Queues a task for future processing', function(t) {

        var task = {
            name: 'task3'
        }

        var when = Date.now() + 5000;
        return q.scheduleTask(task, when).
            then(function(key) {
                return util.once(qRef.child(key), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, task.name, 'Returns original data');
                        t.ok(actual._dueAt === when, 'Is scheduled 5s into the future');
                    });
            });
    });
}


function processesTasks() {

    return util.testP('Processes the queued tasks', function(t) {
        return new Promise(function(resolve, reject) {
            var count = 0;
            q.start(function(task) {
                count++;
                t.equal(task.data.name, 'task' + count, 'Processing task ' + count);
                task.success();
                if (count === 3) {
                    resolve();
                }
            });
        }).
        then(function() {
            // Verify that the queue is empty.
            return util.once(qRef, 'value').
                then(function(snapshot) {
                    t.ok(!snapshot.exists(), 'Queue is now empty');
                });
        }).
        then(function() {
            q.dispose();
        });
    });
}




// Verify that a disposed queue cannot be used.
