var test = require('tape');

var Firebase = require('firebase');

var ref = new Firebase('https://' + process.env.FIREBASE_NAME + '.firebaseio.com/queues');

module.exports = {
    login: login,
    once: once,
    testP: testP,
    ref: ref
}

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
                try {
                    var p = testFn.call(null, t);
                } catch (err) {
                    t.end(false);
                    reject(err);
                    return;
                }
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
