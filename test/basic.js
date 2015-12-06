var FireTaskQueue = require('../src/');
var util = require('./util');

module.exports = {
    queuesTaskForImmediateProcessing: queuesTaskForImmediateProcessing,
    queuesTaskForFutureProcessing: queuesTaskForFutureProcessing,
    processesTasks: processesTasks
}

var qRef = util.ref.child('testq');
var q = new FireTaskQueue('TestQ', qRef);


function queuesTaskForImmediateProcessing() {

    return util.testP('Queues a task for immediate processing', function(t) {

        var task = {
            name: 'task1'
        };

        return q.schedule(task).
            then(function(key) {
                t.pass('Schedule method reports success');

                return once(qRef.child(key), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, task.name, 'Returns original data');
                        t.ok(actual._dueAt < Date.now(), 'Has a due date earlier than now');
                    });

            });
    });
}


function queuesTaskForFutureProcessing() {

    return util.testP('Queues a task for future processing', function(t) {

        var task = {
            name: 'task2'
        }

        var when = Date.now() + 10000;
        return q.schedule(task, when).
            then(function(key) {
                return once(qRef.child(key), 'value').
                    then(function(snapshot) {
                        var actual = snapshot.val();
                        t.equal(actual.name, task.name, 'Returns original data');
                        t.ok(actual._dueAt === when, 'Is scheduled 10s into the future');
                    });

            });

    });
}


function processesTasks() {

    return util.testP('Processes the queued tasks', function(t) {
        return new Promise(function(resolve, reject) {
            var count = 0;
            q.monitor(function(id, task, done) {
                console.log(task.name);
                done();
                count++;
                t.equal(task.name, 'task' + count, 'Processing task ' + count);
                if (count === 2) {
                    q.dispose();
                    resolve();
                }
            });
        });
    });
}




// Verify that a disposed queue cannot be used.
