'use strict';

var Firebase = require('firebase');
var Config = require('./config');
var log = require('./util').log;


/**
 * The Task handles the life cycle of a task on the queue. It knows how to write itself to
 * Firebase and delete itself. A Task instance is passed to the consumer's processing callback.
 * The consumer will typically make use of task.data to see what needs to be done, and call
 * Task.success() or Task.fail() to indicate whether processing is successful.
 */
class Task {

    /**
     * @param {string} id The ID of the task.
     * @param {!Object} data The object read from the queue.
     * @param {!Config} config The queue's configuration settings.
     * The next arguments are passed when creating new tasks:
     * @param {number=} opt_dueAt The timestamp at which the task should be executed.
     * @param {number=} opt_attempts The number of previous attemps.
     * @param {Firebase.Value=} opt_error The reason why the last attempt failed.
     */
    constructor(id, data, config, opt_dueAt, opt_attempts, opt_error) {

        /**
         * The unique ID of the task.
         *
         * @type {string}
         * @private
         */
        this.id_ = id;

        /**
         * The data set when the task was scheduled.
         *
         * @type {!Object}
         * @private
         */
        this.data_ = {}
        for (let name in data) {
            if (!Task.SpecialProperties[name]) {
                this.data_[name] = data[name];
            }
        }

        /**
         * The configuration settings of the queue.
         *
         * @type {!Config}
         * @private
         */
        this.config_ = config;

        /**
         * When the task was due.
         *
         * @type {number}
         * @private
         */
        this.dueAt_ = opt_dueAt || data[Task.SpecialProperties.DUE_AT];

        /**
         * How many attempts have been made so far to process the task.
         *
         * @type {number}
         * @private
         */
        this.attempts_ = opt_attempts || data[Task.SpecialProperties.ATTEMPTS] || 0;

        /**
         * The reason the last attempt to process the task failed.
         *
         * @type {Firebase.Value}
         * @private
         */
        this.error_ = opt_error || data[Task.SpecialProperties.ERROR];
    }


    /**
     * Return the ID of the task.
     *
     * @return {string}
     * @export
     */
    get id() {

        return this.id_;
    }


    /**
     * Returns the task data, minus our internal special properties.
     *
     * @return {!Object}
     * @export
     */
    get data() {

        return this.data_;
    }


    /**
     * Returns the timestamp at which the task was scheduled to be executed.
     *
     * @return {number}
     * @export
     */
    get dueAt() {

        return this.dueAt_;
    }


    /**
     * Returns the number of failed attempts made to process this task so far.
     *
     * @return {number}
     * @export
     */
    get attempts() {

        return this.attempts_;
    }


    /**
     * Returns the reason the last attempt failed.
     *
     * @return {Firebase.Value}
     * @export
     */
    get lastFailureReason() {

        return this.error_;
    }


    /**
     * Called by the consumer to indicate the task was processed successfully.
     *
     * @export
     */
    success() {

        log(`${this.config_.name}: Task executed successfully. ID=${this.id_} Attempt=${this.attempts_+1}\n\tData:`,
            this.data_);

        this.delete_();
    }


    /**
     * Called by the consumer to indicate that processing has failed for this task, and that it
     * should be retried.
     *
     * @param {*} reason A value that inidcates what went wrong, for debugging purposes. Typically
     *      an Error instance.
     * @return {!Promise<string,Error>}
     * @export
     */
    fail(reason) {

        log(`${this.config_.name}: Task failed. ID=${this.id_} Attempt=${this.attempts_+1}\n\tReason:`,
            reason, '\n\tTask Data:', this.data_);

        // Prepare the data for the next invocation.

        // Increment the number of failed attempts.
        var attempts = this.attempts_ + 1;

        // Reschedule after a backoff interval.
        var dueAt = Date.now() + this.calculateBackoff_(this.attempts_);

        // Serialize the error value as informatively as possible.
        var error = this.prepareErrorValue_(reason);

        // Update the task data. The effect is to reschedule it for later because we changed the
        // DUE_AT timestamp.
        return this.update(undefined, dueAt, attempts, error);
    }


    /**
     * Deletes the task, typically after we have finished with it.
     *
     * @return {!Promise<null,Error>}
     * @private
     */
    delete_() {

        var name = this.config_.name;
        var id = this.id_;
        log(`${name} Deleting task ${id} ...`);

        var self = this;
        return new Promise(function(resolve, reject) {
            self.config_.ref.child(id).remove(function(/** Error */err) {
                if (!err) {
                    log(`${name}: Task deleted successfully ID=${id}`);
                    resolve();
                } else {
                    log(`${name}: Failed to delete task - it will eventually be reprocessed ID=${id}`,
                        err);
                    reject(err);
                }
            });
        });
    }


    /**
     * Creates or updates a task.
     *
     * @param {Object=} opt_data The data, which does not include our special properties e.g. DUE_AT.
     * @param {number=} opt_dueAt The timestamp at which the task should be executed.
     * @param {number=} opt_attempts The number of previous attemps.
     * @param {Firebase.Value=} opt_error The reason why the last attempt failed.
     * @return {!Promise<string,Error>}
     */
    update(opt_data, opt_dueAt, opt_attempts, opt_error) {

        // Clone our internal data so we don't corrupt it.
        var data = opt_data || Object.assign({}, this.data_);

        // Add our special fields to the data.
        this.addSpecialProperties_(data, opt_dueAt, opt_attempts, opt_error);

        // Say what we're about to do.
        var name = this.config_.name;
        var id = this.id_;
        if (!opt_attempts) {
            log(`${name}: Scheduling task ID=${id}`, data);
        } else {
            log(`${name}: Rescheduling task ID=${id}`, data);
        }

        // If the task exists already, modify it and leave it in the queue. This will trigger a
        // child_changed event if the task stays within the query window. Otherwise it will trigger
        // when the task comes back in the window.
        var self = this;
        return new Promise(function(resolve, reject) {
            self.config_.ref.child(self.id_).update(data, function(/**Error*/err) {
                if (!err) {
                    log(`${name}: Task rescheduled ID=${id}`, data);
                    resolve(self.id_);
                } else {
                    log(`${name}: Failed to reschedule task. It will eventually be reprocessed ID=${id}`,
                        data, err);
                    reject(err);
                }
            });
        });
    }


    /**
     * Saves the task to Firebase, but only if a task with the same ID does not already exist.
     *
     * @return {!Promise<string,Error>}
     */
    saveIfUnique() {

        // Clone our internal data so we don't corrupt it.
        var data = Object.assign({}, this.data_);

        // Add our special fields to the data.
        this.addSpecialProperties_(data);

        // Say what we're about to do.
        var name = this.config_.name;
        var id = this.id_;
        log(`${name}: Scheduling exclusive task ID=${id}`, data);

        var self = this;
        return new Promise(function(resolve, reject) {

            self.config_.ref.child(id).transaction(function(/**Object*/existingTask) {

                // If the task does not exist, save the data. Otherwise, abort.
                return !existingTask ? data : undefined;

            }, function(/**Error*/err, /**boolean*/committed, /**!Firebase.DataSnapshot*/snapshot) {

                if (!err) {
                    if (committed) {
                        // Indicate that we have succeeded in scheduling the task.
                        log(`${name}: Task scheduled successfully ID=${id}`, data);
                        resolve(id);
                    } else {
                        // Indicate that we failed to schedule the task.
                        log(`${name} : Failed to schedule task - duplicate ID=${id}`, data);
                        reject(new DuplicateIdError(id));
                    }
                } else {
                    // Indicate that we failed to schedule the task.
                    log(`${name}: ERROR while scheduling task ID=${name}`, data, err);
                    reject(err);
                }
            }, false);
        });
    }


    /**
     * Adds special properties to a supplied object.
     *
     * @param {!Object} data The data.
     * @param {number=} opt_dueAt The timestamp at which the task should be executed. If not
     *      supplied, this will be set to the current time on the server when saved.
     * @param {number=} opt_attempts The number of previous attemps.
     * @param {Firebase.Value=} opt_error The reason why the last attempt failed.
     * @private
     */
    addSpecialProperties_(data, opt_dueAt, opt_attempts, opt_error) {

        data[Task.SpecialProperties.DUE_AT] = opt_dueAt || this.dueAt_ || Firebase.ServerValue.TIMESTAMP;

        if (opt_attempts) {
            data[Task.SpecialProperties.ATTEMPTS] = opt_attempts;
        }

        if (opt_error) {
            data[Task.SpecialProperties.ERROR] = opt_error;
        }
    }


    /**
     * Calculate the number of milliseconds to wait between retries, doubling the interval each time.
     *
     * @param {number} attempts The number of retry attempts so far.
     * @return {number} of milliseconds to wait.
     * @private
     */
    calculateBackoff_(attempts) {

        // Calculate the backoff according to doubling intervals.
        var delay = Math.pow(2, attempts) * this.config_.minBackOff;

        // Limit it to the maximum period.
        return Math.min(delay, this.config_.maxBackOff);
    }


    /**
     * When the consumer's callback returns/throws a value, we try to store it in Firebase. If we
     * can use it as-is, we will. Otherwise, we'll try to serialize it as informatively as possible.
     *
     * @param {*} errVal The value returned by the consumer's callback.
     * @return {Firebase.Value}
     * @private
     */
    prepareErrorValue_(errVal) {

        switch (typeof errVal) {

            case 'string':
            case 'number':
            case 'boolean':
                return errVal;

            case 'object':
                // Special handling for errors, because they don't output rich info in .toString()
                // and the useful properties are not iterable.
                if (errVal instanceof Error) {
                    var v = /** @type {!Error} */(errVal);
                    var e = {
                        'name': v.name || '',
                        'message': v.message || ''
                    }
                    if (v.stack) {
                        e['stack'] = v.stack;
                    }
                    return e;
                }

                if (typeof errVal.toJson === 'function') {
                    return errVal.toJson();
                }

                // If it has a non-default toString method, use it.
                if (typeof errVal.toString === 'function' &&
                        errVal.toString !== Object.prototype.toString) {
                    return errVal.toString();
                }

                if (isStorable(errVal)) {
                    return /** @type {Firebase.Value} */(errVal);
                }

                // Reaching here means we've received a value that the consumer did not plan for.
                return errVal.toString();

            default:
                return null;
        }

        /**
         * Determines whether a value is a primitive, i.e. likely to be storable in Firebase.
         *
         * @param {*} val
         * @return {boolean}
         */
        function isStorable(val) {

            switch (typeof val) {

                case 'string':
                case 'number':
                case 'boolean':
                    return true;

                case 'undefined':
                case 'symbol':
                    // These values will cause problems in Firebase.
                    return false;

                case 'object':
                    // typeof null === 'object'
                    if (val === null) {
                        return true;
                    }

                    // Does it have at least one property that Firebase can store?
                    for (var p in val) {
                        if (isStorable(val[p])) {
                            return true;
                        }
                    }
                    return false; // No storable properties --> nothing will be stored.

                default:
                    return false;
            }
        }
    }
}


/**
 * @enum {string}
 */
Task.SpecialProperties = {

    /**
     * The due date of the task.
     */
    DUE_AT: '_dueAt',

    /**
     * The number of times a task has been processed, if it fails.
     */
    ATTEMPTS: '_attempts',

    /**
     * The error value returned from the last failure.
     */
    ERROR: '_error'
}


/**
 * A custom error we pass back to indicate that a task with a specified ID could not be created
 * because another task has that ID.
 */
class DuplicateIdError extends Error {

    /**
     * @param {string} id
     */
    constructor(id) {
        super();
        this.name = 'DuplicateIdError';
        this.message = 'A task with that ID already exists: ' + id;
    }
}


module.exports = {
    Task: Task,
    DuplicateIdError: DuplicateIdError
}
