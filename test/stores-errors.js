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
            var qName = 'test-record-errors' + util.ref.push().key();
            FireTaskQueue.start(util.ref.child(qName), function(task) {

                // The first time this is called for each task, return an error.
                if (!task.attempts) {
                    task.fail(testData[task.data.type]);
                    return;
                }

                // This is not the first time, so compare actual with expected error value.
                switch (task.data.type) {
                    case 'string':
                    case 'number':
                    case 'boolean':
                        t.equal(task.lastFailureReason, testData[task.data.type], 'Primitive value stored correctly: ' + task.data.type);
                        break;

                    case 'date':
                        t.equal(typeof task.lastFailureReason, 'string', 'Dates are serialized as strings');
                        t.equal(task.lastFailureReason, testData.date.toString(), 'Dates are serialized correctly');
                        break;

                    case 'error':
                        t.equal(typeof task.lastFailureReason, 'object', 'Errors are serialized as objects');
                        var expectedError = {
                            name: testData.error.name,
                            message: testData.error.message,
                            stack: testData.error.stack
                        }
                        t.deepEqual(task.lastFailureReason, expectedError, 'Errors are serialized correctly');
                        break;

                    case 'simpleObject':
                        t.equal(typeof task.lastFailureReason, 'object', 'Simple objects are not serialized');
                        t.deepEqual(task.lastFailureReason, testData.simpleObject, 'Simple objects are stored correctly');
                        break;

                    case 'nestedObject':
                        t.equal(typeof task.lastFailureReason, 'object', 'Nested objects are not serialized');
                        t.deepEqual(task.lastFailureReason, testData.nestedObject, 'Nested objects are stored correctly');
                        break;

                    case 'jsonableObject':
                        t.equal(typeof task.lastFailureReason, 'object', 'The .toJson() method is used when available');
                        t.deepEqual(task.lastFailureReason, testData.jsonableObject.toJson(), 'Objects with a .toJson() method are stored correctly');
                        break;

                    case 'stringableObject':
                        t.equal(typeof task.lastFailureReason, 'string', 'Non-JSONable objects are stored as strings');
                        t.equal(task.lastFailureReason, testData.stringableObject.toString(), 'Objects with their own .toString() method are stored correctly');
                        break;

                    case 'nonCoopStorableObject':
                        t.equal(typeof task.lastFailureReason, 'object', 'Non-cooperative storable objects are stored as objects');
                        t.deepEqual(task.lastFailureReason, testData.nonCoopStorableObject, 'Non-cooperative storable objects are stored correctly');
                        break;

                    case 'nonCoopEmptyObject':
                        t.equal(typeof task.lastFailureReason, 'string', 'Non-cooperative objects with no storable properties are serialized as strings');
                        t.equal(task.lastFailureReason, testData.nonCoopEmptyObject.toString(), 'Non-cooperative objects with no storable properties are stored correctly');
                        break;

                    default:
                        t.fail('We failed to handle this case: ' + task.data.type);
                        // task.success();
                        reject();
                }


                // Mark this test as having been done.
                tested[task.data.type] = true;
                task.success();

                // Have we finished the tests?
                if (Object.keys(tested).length === Object.keys(testData).length) {
                    resolve();
                }
            });

            FireTaskQueue.scheduleTask(qName, {'type': 'string'});
            FireTaskQueue.scheduleTask(qName, {'type': 'number'});
            FireTaskQueue.scheduleTask(qName, {'type': 'boolean'});
            FireTaskQueue.scheduleTask(qName, {'type': 'date'});
            FireTaskQueue.scheduleTask(qName, {'type': 'error'});
            FireTaskQueue.scheduleTask(qName, {'type': 'simpleObject'});
            FireTaskQueue.scheduleTask(qName, {'type': 'nestedObject'});
            FireTaskQueue.scheduleTask(qName, {'type': 'jsonableObject'});
            FireTaskQueue.scheduleTask(qName, {'type': 'stringableObject'});
            FireTaskQueue.scheduleTask(qName, {'type': 'nonCoopStorableObject'});
            FireTaskQueue.scheduleTask(qName, {'type': 'nonCoopEmptyObject'});
        });
    });
}
