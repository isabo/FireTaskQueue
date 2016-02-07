'use strict';


var Registry = require('./registry');
var Config = require('./config');
var Worker = require('./worker');
var Task = require('./task').Task;
var log = require('./util').log;


/**
 * Represents a queue that contains task objects that need to be processed. This is the main
 * interface that consumer projects will interact with.
 */
class Queue {

    /**
     * @param {string} name A name for the queue that can be used when invoking class methods
     *      instead of using an instance.
     * @param {!Firebase} ref Firebase ref of node that holds this queue's data.
     */
    constructor(name, ref) {

        log(name + ': Creating queue instance at ' + ref.toString());

        /**
         * @type {string}
         * @private
         */
        this.name_ = name;

        // Register the queue for use with just its name.
        Registry.register(this);

        /**
         * Create a config instance that we can pass around.
         *
         * @type {Config}
         * @private
         */
        this.config_ = new Config(this.name_, ref);

        /**
         * Create a worker, which takes tasks off the queue and executes them.
         *
         * @type {Worker}
         * @private
         */
        this.worker_ = new Worker(this.config_);
    }


    dispose() {

        log(this.name_ + ': Disposing queue instance');

        this.worker_.dispose();
        this.worker_ = null;
        this.config_ = null;
        Registry.unregister(this);

        log(this.name_ + ': Disposed queue instance');
    }


    /**
     * Returns the name of the queue.
     *
     * @return {string}
     */
    get name() {

        return this.name_;
    }


    /**
     * Registers a callback function that will be called for each task in the queue and starts
     * monitoring.
     *
     * @param {function(!Task):(Promise|undefined)} fn A function that processes a task from the queue.
     * @param {number=} opt_parallelCount The number of tasks that are allowed to execute in parallel.
     * @param {number=} opt_maxBackOff Failed tasks should be retried at intervals no larger than this
     *  (microseconds).
     * @param {number=} opt_minBackOff Failed tasks should be retried at intervals no smaller than this
     *  (microseconds).
     */
    start(fn, opt_parallelCount, opt_maxBackOff, opt_minBackOff) {

        this.config_.processorFn = fn;

        if (opt_parallelCount) {
            this.config_.parallelCount = opt_parallelCount;
        }

        if (opt_maxBackOff) {
            this.config_.maxBackOff = opt_maxBackOff;
        }

        if (opt_minBackOff) {
            this.config_.minBackOff = opt_minBackOff;
        }

        this.worker_.start();
    }


    /**
     * Schedules a task for processing on this queue.
     *
     * @param {!Object} data The data that needs to be processed.
     * @param {Date|number=} opt_when When to try to process the task (not before).
     * @param {string=} opt_Id The ID to assign the new task. This is not necessary, but can be
     *      used to prevent duplicate tasks being created.
     * @param {boolean=} opt_replace If an ID was specified, whether this task replaces an existing
     *      one with the same ID. Default: false. If true, an existing task may be overwritten with
     *      the new task, an no error will be returned.
     * @param {Task=} opt_taskToDelete_ For internal use only. The task that should be deleted at
     *      the same time the new task is created.
     * @return {!Promise<string,(Error|DuplicateIdError)>} which resolves to the ID of the
     *      newly created task if successful or is rejected if not. If rejected because opt_Id was
     *      specified and a task with the same ID already exists, the rejected value will be an
     *      error of the type DuplicateIdError.
     */
    scheduleTask(data, opt_when, opt_Id, opt_replace, opt_taskToDelete_) {

        // Generate an ID if not specified.
        var id = opt_Id || this.config_.ref.push().key();

        // Convert dates to integers if necessary.
        if (opt_when && typeof opt_when.getTime === 'function') {
            opt_when = opt_when.getTime();
        }

        // Create and save the task.
        var msg = this.config_.name + ': Scheduling a task for ' +
            (!opt_when ? 'immediate execution ' : 'execution at ' + new Date(opt_when)) +
            (opt_Id ? 'with ID=' + opt_Id : '') + ' ...';
        log(msg, data);

        var task = new Task(id, data, this.config_, /**@type {number}*/(opt_when));
        if (!opt_Id || opt_Id && opt_replace) {
            if (!opt_taskToDelete_) {
                return task.update();
            }
            return task.updateAndDelete(opt_taskToDelete_);
        } else {
            return task.saveIfUnique();
        }
    }


    /**
     * Schedules a task for processing on the named queue.
     *
     * @param {string} queueName The name of the queue.
     * @param {!Object} data Data that represents a task that needs to be processed.
     * @param {Date|number=} opt_when When to try to process the task.
     * @param {string=} opt_taskId The ID to assign the new task. This is not necessary, but can be
     *      used to prevent duplicate tasks being created.
     * @param {boolean=} opt_replace If an ID was specified, whether this task replaces an existing
     *      one with the same ID. Default: false. If true, an existing task may be overwritten with
     *      the new task, an no error will be returned.
     * @return {!Promise<string,(Error|DuplicateIdError)>} which resolves to the ID of the newly
     *      created task if successful or is rejected if not. If rejected because opt_taskId was
     *      specified and a task with the same ID already exists, the rejected value will be an
     *      error of the type DuplicateIdError.
     */
    static scheduleTask(queueName, data, opt_when, opt_taskId, opt_replace) {

        var q = Registry.get(queueName);
        if (q) {
            return q.scheduleTask(data, opt_when, opt_taskId, opt_replace);
        } else {
            return Promise.reject(new Error('No such queue'));
        }
    }


    /**
     * Registers a function that will be called for each task in the queue, and starts processing
     * tasks.
     *
     * @param {!Firebase|string} queueRefOrName The Firebase reference of the queue or its name. If passing a
     *      ref, the queue will be created if it does not yet exist. Passing a name is for queues that
     *      already exist.
     * @param {function(!Task):(Promise|undefined)} fn A function that processes a task from the queue. It should accept the
     *      following arguments: id {string}, task {!Object}, done {function(*)}
     *      When processing is complete, done() should be called without arguments to indicate success,
     *      and with an error or any other value except undefined and null to indicate failure.
     * @param {number=} opt_parallelCount The number of tasks that are allowed to execute in parallel.
     * @param {number=} opt_maxBackOff Failed tasks should be retried at intervals no larger than this
     *  (microseconds).
     * @param {number=} opt_minBackOff Failed tasks should be retried at intervals no smaller than this
     *  (microseconds).
     */
    static start(queueRefOrName, fn, opt_parallelCount, opt_maxBackOff, opt_minBackOff) {

        var q;
        if (typeof queueRefOrName === 'string') {

            q = Registry.get(queueRefOrName);
            if (!q) {
                return Promise.reject(new Error('No such queue'));
            }

        } else if (queueRefOrName instanceof Firebase) {

            var name = queueRefOrName.key();
            q = Registry.get(name);
            if (!q) {
                q = new Queue(name, queueRefOrName);
            }
        }

        if (!q) {
            return Promise.reject(new Error('queueRefOrName must be a Firebase reference or a string'));
        }

        return q.start(fn, opt_parallelCount, opt_maxBackOff, opt_minBackOff);
    }


    /**
     * Returns the instance of the named queue.
     *
     * @param {string} name The name of the queue.
     * @return {!Queue|undefined}
     */
    static get(name) {

        return Registry.get(name);
    }


    /**
     * Destroys all queues and cleans up.
     */
    static disposeAll() {

        var names = Registry.getNames();
        for (var i=0; i<names.length; i++) {
            Registry.get(names[i]).dispose(); // each queue will self-unregister.
        }
    }
}


module.exports = Queue;
