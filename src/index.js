var Fbase = require('firebase'); // Can't name it Firebase - that clashes with firebase-externs.


/**
 * Represents a queue that contains task objects that need to be processed.
 *
 * @param {string} name A name for the queue that can be used when invoking class methods instead of
 *      using an instance.
 * @param {!Firebase} ref Firebase ref of node that holds this queue's data.
 * @constructor
 */
var FireTaskQueue = function(name, ref) {

    FireTaskQueue.log_(name + ': Creating queue instance at ' + ref.toString());

    /**
     * @type {string}
     * @private
     */
    this.name_ = name;

    /**
     * @type {!Firebase}
     * @private
     */
    this.ref_ = ref;

    /**
     * The query that returns tasks that need to be processed.
     *
     * @type {Firebase.Query}
     * @private
     */
    this.query_;

    /**
     * A callback function provided by the consumer that will be invoked for each task on the queue.
     *
     * @type {ProcessorFn}
     * @private
     */
    this.processor_;

    /**
     * The number of tasks we can process in parallel.
     *
     * @type {number}
     * @private
     */
    this.parallelCount_ = FireTaskQueue.DEFAULT_PARALLEL_COUNT;

    /**
     * The minimum time (milliseconds) to wait before reattempting to process a task after
     * processing failed.
     *
     * @type {number}
     * @private
     */
    this.minBackOff_ = FireTaskQueue.DEFAULT_MIN_FAILURE_BACKOFF;

    /**
     * The maximum time (milliseconds) to wait before reattempting to process a task after
     * processing failed.
     *
     * @type {number}
     * @private
     */
    this.maxBackOff_ = FireTaskQueue.DEFAULT_MAX_FAILURE_BACKOFF;

    /**
     * Whether this queue is being monitored by the current process. In order to schedule tasks,
     * the queue needs to be instantiated, but not necessarily monitored.
     *
     * @type {boolean}
     * @private
     */
    this.isMonitoring_ = false;

    /**
     * The time at which we have booked a refresh for the query so that we will get child_added
     * events for everything again -- so that we can process items we previously ignored.
     *
     * @type {?number}
     * @private
     */
    this.queryRefreshTime_;

    /**
     * The value returned by setTimeout which is needed to cancel it if necessary.
     *
     * @private
     */
    this.queryRefreshHandle_;

    // Self-register.
    FireTaskQueue.registerQueue_(this);
};


/**
 * Cleans up.
 */
FireTaskQueue.prototype.dispose = function() {

    FireTaskQueue.log_(this.name_ + ': Disposing queue instance');

    FireTaskQueue.unregisterQueue_(this);

    this.stopMonitoring_();
    delete this.processor_; // = null;
    delete this.ref_ //= null;

    FireTaskQueue.log_(this.name_ + ': Queue instance disposed');
};


/**
 * Returns the name of the queue.
 *
 * @return {string}
 */
FireTaskQueue.prototype.getName = function() {

    return this.name_;
};


/**
 * Schedules a task for processing on this queue.
 *
 * @param {!Object} taskData A task that needs to be processed.
 * @param {Date|number=} opt_when When to try to process the task (not before).
 * @param {string=} opt_taskId The ID to assign the new task. This is not necessary, but can be
 *      used to prevent duplicate tasks being created.
 * @return {!Promise<string,(Error|FireTaskQueue.DuplicateIdError)>} which resolves to the ID of the
 *      newly created task if successful or is rejected if not. If rejected because opt_taskId was
 *      specified and a task with the same ID already exists, the rejected value will be an error of
 *      the type FireTaskQueue.DuplicateIdError.
 */
FireTaskQueue.prototype.schedule = function(taskData, opt_when, opt_taskId) {

    // Convert dates to integers if necessary.
    if (opt_when && typeof opt_when.getTime === 'function') {
        opt_when = opt_when.getTime();
    }
    taskData[FireTaskQueue.TaskProperties.DUE_AT] = opt_when || Fbase.ServerValue.TIMESTAMP;

    var msg = this.name_ + ': Scheduling a task for ' +
        (!opt_when ? 'immediate execution ' : 'execution at ' + new Date(opt_when)) +
        (opt_taskId ? 'with ID=' + opt_taskId : '') + ' ...';
    FireTaskQueue.log_(msg, taskData);

    if (!opt_taskId) {
        return this.scheduleTaskAutoId_(taskData);
    } else {
        return this.scheduleTaskUsingId_(opt_taskId, taskData);
    }
};


/**
 * Schedules a task for processing on this queue.
 *
 * @param {!Object} taskData The task data, which already includes the due time.
 * @return {!Promise<string,Error>} which resolves to the ID of the newly created task if
 *      successful or is rejected if not.
 * @private
 */
FireTaskQueue.prototype.scheduleTaskAutoId_ = function(taskData) {

    var self = this;
    return new Promise(function(resolve, reject) {

        // Generate an ID for the new task.
        var taskId = self.ref_.push().key();

        // Set the data.
        self.ref_.child(taskId).set(taskData, function(/**Error*/err) {

            if (!err) {
                FireTaskQueue.log_(self.name_ + ': Task scheduled successfully: [' + taskId + ']',
                    taskData);

                // Indicate that we have succeeded in scheduling the task.
                resolve(taskId);

            } else {
                FireTaskQueue.log_(self.name_ + ': ERROR while scheduling task:', taskData, err);

                // Indicate that we failed to schedule the task.
                reject(err);
            }
        });
    });
};


/**
 * Schedules a task with a specific ID for processing on this queue. If a task with that ID already
 * exists, the operation will fail, and the promise will be rejected with an error of the type
 * FireTaskQueue.DuplicateIdError.
 *
 * @param {string} taskId The ID to assign the task.
 * @param {!Object} taskData The task data, which already includes the due time.
 * @return {!Promise<string,(Error|FireTaskQueue.DuplicateIdError)>} which resolves to the ID of the
 *      newly created task if successful or is rejected if not.
 * @private
 */
FireTaskQueue.prototype.scheduleTaskUsingId_ = function(taskId, taskData) {

    var self = this;
    return new Promise(function(resolve, reject) {

        // A task ID was provided: create the task only if there is no such task.

        self.ref_.child(taskId).transaction(function(/**Object*/existingTask) {

            // If the task does not exist, save the data. Otherwise, abort.
            return !existingTask ? taskData : undefined;

        }, function(/**Error*/err, /**boolean*/committed, /**!Firebase.DataSnapshot*/snapshot) {

            if (!err) {

                if (committed) {
                    FireTaskQueue.log_(self.name_ + ': Task scheduled successfully: [' +
                        taskId + ']', taskData);

                    // Indicate that we have succeeded in scheduling the task.
                    resolve(taskId);

                } else {
                    FireTaskQueue.log_(self.name_ + ': Failed to schedule task - duplicate ID: ' +
                        '[' + taskId + ']', taskData);

                    // Indicate that we failed to schedule the task.
                    reject(new FireTaskQueue.DuplicateIdError(taskId));
                }

            } else {
                FireTaskQueue.log_(self.name_ + ': ERROR while scheduling task:', taskData, err);

                // Indicate that we failed to schedule the task.
                reject(err);
            }
        }, false);
    });
};


/**
 * Registers a callback function that will be called for each task in the queue and starts
 * monitoring.
 *
 * @param {ProcessorFn} fn A function that processes a task from the queue. It should accept the
 *      following arguments: id {string}, task {!Object}, done {function(*)}
 *      When processing is complete, done() should be called without arguments to indicate success,
 *      and with an error or any other value except undefined and null to indicate failure.
 * @param {number=} opt_parallelCount The number of tasks that are allowed execute in parallel.
 * @param {number=} opt_maxBackOff Failed tasks should be retried at intervals no larger than this
 *      (microseconds).
 * @param {number=} opt_minBackOff Failed tasks should be retried at intervals no smaller than this
 *      (microseconds).
 */
FireTaskQueue.prototype.monitor = function(fn, opt_parallelCount, opt_maxBackOff, opt_minBackOff) {

    this.processor_ = fn;

    if (opt_parallelCount) {
        this.parallelCount_ = opt_parallelCount;
        FireTaskQueue.log_(this.name_ + ': Maximum parallel tasks set to ' + this.parallelCount_);
    }

    if (opt_maxBackOff) {
        this.maxBackOff_ = opt_maxBackOff;
        FireTaskQueue.log_(this.name_ + ': Maximum backoff set to ' + this.maxBackOff_ + ' ms');
    }

    if (opt_minBackOff) {
        this.minBackOff_ = opt_minBackOff;
        FireTaskQueue.log_(this.name_ + ': Minimum backoff set to ' + this.minBackOff_ + ' ms');
    }

    this.startMonitoring_();
};


/**
 * Executes a Firebase query that will call us back for each task in the queue.
 *
 * @private
 */
FireTaskQueue.prototype.startMonitoring_ = function() {

    if (this.isMonitoring_) return;

    FireTaskQueue.log_(this.name_ + ': Starting ...');

    // Our query will be a rolling window containing the first X tasks that need to be executed.
    this.query_ = this.ref_.orderByChild(FireTaskQueue.TaskProperties.DUE_AT).limitToFirst(this.parallelCount_);
    this.query_.on('child_added', this.processTask_, function(err){}, this);
    this.query_.on('child_changed', this.processTask_, function(err){}, this);
    this.isMonitoring_ = true;

    FireTaskQueue.log_(this.name_ + ': Started');
};


/**
 * Ensures that the queue is no longer being monitored.
 *
 * @private
 */
FireTaskQueue.prototype.stopMonitoring_ = function() {

    if (!this.isMonitoring_) return;

    FireTaskQueue.log_(this.name_ + ': Stopping ...');

    this.query_.off('child_added', this.processTask_, this);
    this.query_.off('child_changed', this.processTask_, this);
    this.query_ = null;

    if (this.queryRefreshTime_) {
        this.cancelQueryRefresh_();
    }

    this.isMonitoring_ = false;

    FireTaskQueue.log_(this.name_ + ': Stopped');
};


/**
 * Process a task.
 *
 * @param {!Firebase.DataSnapshot} snapshot
 * @private
 */
FireTaskQueue.prototype.processTask_ = function(snapshot) {

    var taskData = /** @type {!Object} */(snapshot.val());
    var taskId = snapshot.key();

    FireTaskQueue.log_(this.name_ + ': Processing task ' + taskId + ' ...', taskData);

    // If the task is scheduled for later than now, ignore it. But when will we catch it again?
    // Schedule a query refresh for the future so we will get its child_added event again.
    var dueAt = /** @type {number} */(taskData[FireTaskQueue.TaskProperties.DUE_AT]);
    if (dueAt > Date.now()) {

        FireTaskQueue.log_(this.name_ + ': Task ' + taskId + ' is not due until ' +
            new Date(taskData[FireTaskQueue.TaskProperties.DUE_AT]), taskData);
        this.scheduleQueryRefresh_(dueAt);

    } else {

        try {
            // Call the processor, and pass it a function it can call (even asynchronously) to tell
            // us whether it succeeded, so that we can reschedule the item or delete it.
            var done = this.finishTask_.bind(this, taskId, taskData);
            var retVal = this.processor_.call(null, taskId, taskData, done);

            // If processor function returns a promise, it does not need to call done(). We will
            // do that when the promise settles.
            if (retVal && typeof retVal['then'] === 'function') {
                retVal.then(function(rv) {
                    // The promise may have returned a value, but the done() function must be called
                    // without a value in order to indicate success.
                    done();
                }, function(err){
                    // The promise may have been rejected, but without passing a reason.
                    done(err || new Error('Task Failed, but did not return a specific error'));
                });
            }
        } catch (err) {
            // Consumer's processor method threw an exception, i.e. it failed. Schedule a retry.
            this.finishTask_(taskId, taskData, err);
        }
    }
};


/**
 * Deletes the item if it was successfully processed. Otherwise, reschedules it for an exponentially
 * increasing deadline.
 *
 * @param {string} taskId The ID of the task in the queue.
 * @param {!Object} taskData The task data taken from the queue.
 * @param {*=} retVal Whether the consumer's callback succeeded in processing the task. If not, we
 *      schedule a retry.
 *      undefined = succeeded, false or Error or anything else means it failed.
 * @private
 */
FireTaskQueue.prototype.finishTask_ = function(taskId, taskData, retVal) {

    var self = this;
    if (retVal !== undefined && retVal !== null) {

        FireTaskQueue.log_(this.name_ + ': Task failed: ' + taskId, taskData, retVal);
        this.rescheduleTask_(taskId, taskData, retVal);

    } else {

        FireTaskQueue.log_(this.name_ + ': Task executed successfully: ' + taskId, taskData);
        this.deleteTask_(taskId);
    }
};


/**
 * Reschedules a task for which processing failed.
 *
 * @param {string} taskId The ID of the task that failed.
 * @param {!Object} taskData The task data.
 * @param {*=} retVal The error data returned when the task failed.
 * @private
 */
FireTaskQueue.prototype.rescheduleTask_ = function(taskId, taskData, retVal) {

    FireTaskQueue.log_(this.name_ + ': Rescheduling task ' + taskId, taskData, retVal);

    // Hold the changes we need to make to the task.
    var changes = {};

    // Increment the number of failed attempts.
    var attempts = taskData[FireTaskQueue.TaskProperties.ATTEMPTS] || 0;
    changes[FireTaskQueue.TaskProperties.ATTEMPTS] = attempts + 1;

    // Reschedule after a backoff interval.
    changes[FireTaskQueue.TaskProperties.DUE_AT] = Date.now() + this.calculateBackoff_(attempts);

    // Serialize the error value as informatively as possible.
    changes[FireTaskQueue.TaskProperties.ERROR] = this.prepareErrorValue_(retVal);

    // Modify the existing task and leave it in the queue. This will trigger a child_changed event
    // if the task stays within the query window.
    var self = this;
    this.ref_.child(taskId).update(changes, function(/**Error*/err) {
        var msg = (!err ? 'Task rescheduled: ' :
            'Failed to reschedule task. It will eventually be reprocessed: ');
        FireTaskQueue.log_(self.name_ + ': ' + msg + taskId, taskData, err);
    });
};


/**
 * Deletes the task after we have finished with it.
 *
 * @param {string} taskId The ID of the task.
 * @private
 */
FireTaskQueue.prototype.deleteTask_ = function(taskId) {

    FireTaskQueue.log_(this.name_ + ': Deleting task ' + taskId + ' ...');

    var self = this;
    this.ref_.child(taskId).remove(function(/** Error */err) {
        if (!err) {
            FireTaskQueue.log_(self.name_ + ': Task ' + taskId + ' deleted successfully');
        } else {
            FireTaskQueue.log_(self.name_ +
                ': Failed to delete task - it will eventually be reprocessed', taskId,  err);
        }
    });
};


/**
 * Calculate the number of milliseconds to wait between retries, doubling the interval each time.
 *
 * @param {number} attempts The number of retry attempts so far.
 * @return {number} of milliseconds to wait.
 * @private
 */
FireTaskQueue.prototype.calculateBackoff_ = function(attempts) {

    // Calculate the backoff according to doubling intervals.
    var delay = Math.pow(2, attempts) * this.minBackOff_;

    // Limit it to the maximum period.
    return Math.min(delay, this.maxBackOff_);
};


/**
 * When the consumer's callback returns/throws a value, we try to store it in Firebase. If we can
 * use it as-is, we will. Otherwise, we'll try to serialize it as informatively as possible.
 *
 * @param {*} errVal The value returned by the consumer's callback.
 * @return {Firebase.Value}
 * @private
 */
FireTaskQueue.prototype.prepareErrorValue_ = function(errVal) {

    switch (typeof errVal) {

        case 'string':
        case 'number':
        case 'boolean':
            return errVal;

        case 'object':
            // Special handling for errors, because they don't output rich info in .toString() and
            // the useful properties are not iterable.
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
};


/**
 * If we encounter a future task when processing the queue, we need to revisit it at the appointed
 * time. If until then it does not drop out of the window, we will not get another child_added
 * event for it. The solution is to book a refresh of our query for the appointed time.
 *
 * @param {number} dueAt The date/time the task is due to be executed. Numeric format.
 * @private
 */
FireTaskQueue.prototype.scheduleQueryRefresh_ = function(dueAt) {

    var isNecessary = this.queryRefreshTime_ && dueAt < this.queryRefreshTime_ ||
        !this.queryRefreshTime_;

    // If a refresh is already set, cancel it.
    if (isNecessary && this.queryRefreshTime_) {
        this.cancelQueryRefresh_();
    }

    if (isNecessary) {
        var millisecondsToWait = dueAt - Date.now(); // both are UTC - good
        this.queryRefreshHandle_ = setTimeout(this.refreshQuery_.bind(this), millisecondsToWait);
        this.queryRefreshTime_ = dueAt;

        FireTaskQueue.log_(this.name_ + ': Query will be refreshed at ' +
            new Date(this.queryRefreshTime_));
    }
};


/**
 * Cancels the scheduled query refresh.
 *
 * @private
 */
FireTaskQueue.prototype.cancelQueryRefresh_ = function() {

    clearTimeout(this.queryRefreshHandle_);
    FireTaskQueue.log_(this.name_ + ': Query refresh cancelled at ' +
        new Date(this.queryRefreshTime_));

    this.queryRefreshHandle_ = null;
    this.queryRefreshTime_ = null;
};


/**
 * Refreshes or re-executes the Firebase query so that we receive child_added events for any tasks
 * we previously ignored because they were not due to be executed yet.
 *
 * @private
 */
FireTaskQueue.prototype.refreshQuery_ = function() {

    FireTaskQueue.log_(this.name_ + ': Refreshing query ...');

    this.stopMonitoring_();
    this.startMonitoring_();

    FireTaskQueue.log_(this.name_ + ': Query refreshed');
};



// Class properties and methods.

/**
 * A registry of all queue instances.
 *
 * @type {!Object<string,!FireTaskQueue>}
 * @private
 */
FireTaskQueue.instances_ = {};


/**
 * The default number of tasks we allow to be executed in parallel.
 *
 * @const {number}
 */
FireTaskQueue.DEFAULT_PARALLEL_COUNT = 5;


/**
 * The default minimum time (milliseconds) to wait before reattempting to process a task after
 * processing failed.
 *
 * @const {number}
 */
FireTaskQueue.DEFAULT_MIN_FAILURE_BACKOFF = 250;


/**
 * The default maximum time (milliseconds) to wait before reattempting to process a task after
 * processing failed.
 *
 * @const {number}
 */
FireTaskQueue.DEFAULT_MAX_FAILURE_BACKOFF = 3600000; // 1 hour.



/**
 * The names of the reserved properties that this library uses.
 *
 * @enum {string}
 * @private
 */
FireTaskQueue.TaskProperties = {
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
 * The prefix of all log entries we write.
 *
 * @const {string}
 * @private
 */
FireTaskQueue.LOG_PREFIX_ = 'FIRE_TASK_QUEUE:';


/**
 * A custom error we pass back to indicate that a task with a specified ID could not be created
 * because another task has that ID.
 *
 * @constructor
 * @extends {Error}
 */
FireTaskQueue.DuplicateIdError = function(id) {
    this.name = 'DuplicateIdError';
    this.message = 'A task with that ID already exists: ' + id;
};
FireTaskQueue.DuplicateIdError.prototype = Object.create(Error.prototype);
FireTaskQueue.DuplicateIdError.prototype.constructor = FireTaskQueue.DuplicateIdError;


/**
 * Schedules a task for processing on the named queue.
 *
 * @param {string} queueName The name of the queue.
 * @param {!Object} taskData A task that needs to be processed.
 * @param {Date|number=} when When to try to process the item.
 * @return {!Promise} which resolves if successful or is rejected if not.
 */
FireTaskQueue.schedule = function(queueName, taskData, when) {

    var q = FireTaskQueue.get(queueName);
    if (q) {
        return q.schedule(taskData, when);
    } else {
        return Promise.reject(new Error('No such queue'));
    }
};


/**
 * Returns the instance of the named queue.
 *
 * @param {string} name The name of the queue.
 * @return {FireTaskQueue}
 */
FireTaskQueue.get = function(name) {

    return FireTaskQueue.instances_[name];
};


/**
 * Registers a queue. Throws an exception if a duplicate is being created.
 *
 * @param {!FireTaskQueue} queue
 * @private
 */
FireTaskQueue.registerQueue_ = function(queue) {

    var name = queue.getName();
    if (!FireTaskQueue.get(name)) {
        FireTaskQueue.instances_[name] = queue;
    } else {
        throw new Error('A queue with that name already exists');
    }
};


/**
 * Removes a queue from the registry. No error is thrown if the queue did not exist.
 *
 * @param {!FireTaskQueue} queue
 * @private
 */
FireTaskQueue.unregisterQueue_ = function(queue) {

    var name = queue.getName();
    delete FireTaskQueue.instances_[name];
};


/**
 * Registers a function that will be called for each task in the queue, and starts processing tasks.
 *
 * @param {!Firebase|string} queueRefOrName The Firebase reference of the queue or its name. If passing a
 *      ref, the queue will be created if it does not yet exist. Passing a name is for queues that
 *      already exist.
 * @param {ProcessorFn} fn A function that processes a task from the queue. It should accept the
 *      following arguments: id {string}, task {!Object}, done {function(*)}
 *      When processing is complete, done() should be called without arguments to indicate success,
 *      and with an error or any other value except undefined and null to indicate failure.
 * @param {number=} opt_parallelCount The number of tasks that are allowed to execute in parallel.
 * @param {number=} opt_maxBackOff Failed tasks should be retried at intervals no larger than this
 *  (microseconds).
 * @param {number=} opt_minBackOff Failed tasks should be retried at intervals no smaller than this
 *  (microseconds).
 */
FireTaskQueue.monitor = function(queueRefOrName, fn, opt_parallelCount, opt_maxBackOff,
        opt_minBackOff) {

    var q;
    if (typeof queueRefOrName === 'string') {

        q = FireTaskQueue.get(queueRefOrName);
        if (!q) {
            return Promise.reject(new Error('No such queue'));
        }

    } else if (queueRefOrName instanceof Fbase) {

        var name = queueRefOrName.key();
        q = FireTaskQueue.get(name);
        if (!q) {
            q = new FireTaskQueue(name, queueRefOrName);
        }
    }

    if (!q) {
        return Promise.reject(new Error('queueRefOrName must be a Firebase reference or a string'));
    }

    return q.monitor(fn, opt_parallelCount, opt_maxBackOff, opt_minBackOff);
};


/**
 * Destroys all queues and cleans up.
 */
FireTaskQueue.disposeAll = function() {

    for (var name in FireTaskQueue.instances_) {
        FireTaskQueue.instances_[name].dispose();
    }
};


/**
 * Standard logging method.
 *
 * @param {...} var_args
 * @private
 */
FireTaskQueue.log_ = function(var_args) {

    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(FireTaskQueue.LOG_PREFIX_);
    console.log.apply(console, args);
};


/**
 * Processor functions should accept a task ID, a task data argument and a final argument that is a
 * callback function for the consumer to call when the processing is complete. If any value apart
 * from undefined or null is passed to the callback, the task is considered to have failed and
 * will be retried after an appropriate interval.
 *
 * @typedef {function(string, !Object, function(*))}
 */
var ProcessorFn;


module.exports = FireTaskQueue;
