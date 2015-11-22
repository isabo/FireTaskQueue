var test = require('tape'); //require('blue-tape').test;
var Firebase = require('firebase');
var FireTaskQueue = require('../src/');

var ref = new Firebase('https://' + process.env.FIREBASE_NAME + '.firebaseio.com/queues');

var qRef = ref.child('testq');
var q = new FireTaskQueue('TestQ', qRef);


login().
    then(queuesTaskForImmediateProcessing).
    then(queuesTaskForFutureProcessing).
    then(processesTasks).
    then(function() {
        process.exit(0);
    }, function(err) {
        process.exit(1);
    });


function login() {
    return new Promise(function(resolve, reject) {
        try {
            ref.authWithCustomToken(process.env.FIREBASE_TOKEN, function(err) {
                !err ? resolve() : reject();
            });
        } catch (err) {
            reject(err);
        }
    });
}

function once(ref, eventName) {
    return new Promise(function(resolve, reject) {
        ref.once(eventName, function(snapshot) {
            resolve(snapshot);
        }, function(err) {
            reject(err);
        });
    });
}


/**
 * Wrapped version of tape.test() that accepts a Promise return value.
 */
function testP(description, testFn) {
    return new Promise(function(resolve, reject) {
        try {
            test(description, function(t) {
                var p = testFn.call(null, t);
                if (p && typeof p.then === 'function') {
                    p = p.then(function() {
                        t.end();
                    }, function(err) {
                        t.end(false);
                    });
                    resolve(p);
                } else {
                    resolve();
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}


function queuesTaskForImmediateProcessing() {

    return testP('Queues a task for immediate processing', function(t) {

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

    return testP('Queues a task for future processing', function(t) {

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

    return testP('Processes the queued tasks', function(t) {
        return new Promise(function(resolve, reject) {
            var count = 0;
            q.monitor(function(id, task, done) {
                console.log(task.name);
                done(true);
                count++;
                t.equal(task.name, 'task' + count, 'Processing task ' + count);
                if (count === 2) {
                    resolve();
                }
            });
        });
    });
}
