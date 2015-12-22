var util = require('./util');
var FireTaskQueue = require('../src/');

module.exports = storesErrors;


/**
 * Verifies that the queue stores any non-null non-undefined values returned or thrown by the
 * consumer's callback.
 */
function storesErrors() {

    // Prepare some data to use.

    // Does not have an informative .toString() method, but it has an iterable property that has a
    // primitive value, i.e. Firebase will manage to store it.
    var NonCooperativeStorable = function(val) {
        this.val = val;
        this.foo = testData.simpleObject;
    };
    NonCooperativeStorable.prototype.getVal = function(){
        return this.val;
    };

    // Has neither an informative .toString() method nor an iterable property that has a primitive
    // value. Firebase will not be able to store this, and will treat it as null, thus losing the
    // information.
    var NonCooperativeEmpty = function(val) {
        this.getVal = function() {
            return val;
        };
    };

    // Has its own .toString() method, which is considered more informative than iterating any
    // internal properties.
    var Stringable = function(val) {
        this.val = val;
    };
    Stringable.prototype.toString = function() {
        return '' + this.val;
    };

    // Has its own way of serialising itself.
    var Jsonable = function(val) {
        this.val = val;
    };
    Jsonable.prototype.toJson = function() {
        return {val: this.val}
    };

    var testData = {
        string: 'This is a string',
        number: 123,
        boolean: true,
        date: new Date(),
        error: new Error('Error message')
    }
    testData.simpleObject = {
        string: testData.string,
        number: testData.number,
        boolean: testData.boolean
    };
    testData.nestedObject = {
        isNested: true,
        obj: testData.simpleObject
    }
    testData.jsonableObject = new Jsonable(testData.string);
    testData.stringableObject = new Stringable(testData.number);
    testData.nonCoopStorableObject = new NonCooperativeStorable(testData.boolean);
    testData.nonCoopEmptyObject = new NonCooperativeEmpty(testData.boolean);

    // Set up a structure that tracks what we've tested.
    var tested = {}

    // Run the test.
    return util.testP('Records errors', function(t) {
        return new Promise(function(resolve, reject) {
            var qName = 'test-record-errors-' + util.ref.push().key();
            FireTaskQueue.monitor(util.ref.child(qName), function(id, task, done) {

                // The first time this is called for each task, return an error.
                if (!task['_attempts']) {
                    // Return a value - this signals an error.
                    done(testData[task['type']]);
                    return;
                }

                // This is not the first time, so compare actual with expected error value.
                switch (task.type) {
                    case 'string':
                    case 'number':
                    case 'boolean':
                        t.equal(task._error, testData[task.type], 'Primitive value stored correctly: ' + task.type);
                        break;

                    case 'date':
                        t.equal(typeof task._error, 'string', 'Dates are serialized as strings');
                        t.equal(task._error, testData.date.toString(), 'Dates are serialized correctly');
                        break;

                    case 'error':
                        t.equal(typeof task._error, 'object', 'Errors are serialized as objects');
                        var expectedError = {
                            name: testData.error.name,
                            message: testData.error.message,
                            stack: testData.error.stack
                        }
                        t.deepEqual(task._error, expectedError, 'Errors are serialized correctly');
                        break;

                    case 'simpleObject':
                        t.equal(typeof task._error, 'object', 'Simple objects are not serialized');
                        t.deepEqual(task._error, testData.simpleObject, 'Simple objects are stored correctly');
                        break;

                    case 'nestedObject':
                        t.equal(typeof task._error, 'object', 'Nested objects are not serialized');
                        t.deepEqual(task._error, testData.nestedObject, 'Nested objects are stored correctly');
                        break;

                    case 'jsonableObject':
                        t.equal(typeof task._error, 'object', 'The .toJson() method is used when available');
                        t.deepEqual(task._error, testData.jsonableObject.toJson(), 'Objects with a .toJson() method are stored correctly');
                        break;

                    case 'stringableObject':
                        t.equal(typeof task._error, 'string', 'Non-JSONable objects are stored as strings');
                        t.equal(task._error, testData.stringableObject.toString(), 'Objects with their own .toString() method are stored correctly');
                        break;

                    case 'nonCoopStorableObject':
                        t.equal(typeof task._error, 'object', 'Non-cooperative storable objects are stored as objects');
                        t.deepEqual(task._error, testData.nonCoopStorableObject, 'Non-cooperative storable objects are stored correctly');
                        break;

                    case 'nonCoopEmptyObject':
                        t.equal(typeof task._error, 'string', 'Non-cooperative objects with no storable properties are serialized as strings');
                        t.equal(task._error, testData.nonCoopEmptyObject.toString(), 'Non-cooperative objects with no storable properties are stored correctly');
                        break;

                    default:
                        t.fail('We failed to handle this case: ' + task.type);
                        done();
                        reject();
                }


                // Mark this test as having been done.
                tested[task.type] = true;
                done();

                // Have we finished the tests?
                if (Object.keys(tested).length === Object.keys(testData).length) {
                    resolve();
                }
            });

            FireTaskQueue.schedule(qName, {'type': 'string'});
            FireTaskQueue.schedule(qName, {'type': 'number'});
            FireTaskQueue.schedule(qName, {'type': 'boolean'});
            FireTaskQueue.schedule(qName, {'type': 'date'});
            FireTaskQueue.schedule(qName, {'type': 'error'});
            FireTaskQueue.schedule(qName, {'type': 'simpleObject'});
            FireTaskQueue.schedule(qName, {'type': 'nestedObject'});
            FireTaskQueue.schedule(qName, {'type': 'jsonableObject'});
            FireTaskQueue.schedule(qName, {'type': 'stringableObject'});
            FireTaskQueue.schedule(qName, {'type': 'nonCoopStorableObject'});
            FireTaskQueue.schedule(qName, {'type': 'nonCoopEmptyObject'});
        });
    });
}
