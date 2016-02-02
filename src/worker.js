'use strict';


var Task = require('./task').Task;
var Config = require('./config');
var log = require('./util').log;


/**
* The Worker monitors the queue, and pulls out tasks when they need to be executed.
*/
class Worker {

    /**
     * @param {!Config} config
     */
    constructor(config) {

        /**
         * The configuration settings for this queue.
         *
         * @type {!Config}
         * @private
         */
        this.config_ = config;

        /**
         * Whether this queue is being monitored by the current process. In order to schedule tasks,
         * the queue needs to be instantiated, but not necessarily monitored.
         *
         * @type {boolean}
         * @private
         */
        this.isMonitoring_ = false;

        /**
         * The Firebase query that tasks will enter when they become due for execution.
         *
         * @type {Firebase.Query}
         * @private
         */
        this.query_ = null;

        /**
         * The time at which we have booked a refresh for the query so that we will get child_added
         * events for everything again -- so that we can process items we previously ignored.
         *
         * @type {?number}
         * @private
         */
        this.queryRefreshTime_ = null;

        /**
         * The value returned by setTimeout which is needed to cancel it if necessary.
         *
         * @private
         */
        this.queryRefreshHandle_ = null;
    }


    /**
     * Release resources.
     */
    dispose() {

        this.stop_();
    }


    /**
     * Executes a Firebase query that will call us back for each task in the queue.
     */
    start() {

        if (this.isMonitoring_) return;

        log(`${this.config_.name}: Starting ...`);

        // Our query will be a rolling window containing the first X tasks that need to be executed.
        this.query_ = this.config_.ref.
            orderByChild(Task.SpecialProperties.DUE_AT).
            limitToFirst(this.config_.parallelCount);

        this.query_.on('child_added', this.processTask_, function(err){}, this);
        this.query_.on('child_changed', this.processTask_, function(err){}, this);

        this.isMonitoring_ = true;

        log(`${this.config_.name}: Started`);
    }


    /**
     * Ensures that the queue is no longer being monitored.
     *
     * @private
     */
    stop_() {

        if (!this.isMonitoring_) return;

        log(`${this.config_.name}: Stopping ...`);

        this.query_.off('child_added', this.processTask_, this);
        this.query_.off('child_changed', this.processTask_, this);
        this.query_ = null;

        if (this.queryRefreshTime_) {
            this.cancelQueryRefresh_();
        }

        this.isMonitoring_ = false;

        log(`${this.config_.name}: Stopped`);
    }


    /**
     * Process a task.
     *
     * @param {!Firebase.DataSnapshot} snapshot
     * @private
     */
    processTask_(snapshot) {

        var taskData = /** @type {!Object} */(snapshot.val());
        var taskId = snapshot.key();
        var task = new Task(taskId, taskData, this.config_);

        log(`${this.config_.name}: Processing task ${task.id} ...`, task.data);

        // If the task is scheduled for later than now, ignore it. But when will we catch it again?
        // Schedule a query refresh for the future so we will get its child_added event again.
        if (task.dueAt > Date.now()) {

            log(`${this.config_.name}: Task ${task.id} is not due until ${new Date(task.dueAt)}`,
                task.data);
            this.scheduleQueryRefresh_(task.dueAt);

        } else {

            try {
                // Call the processor. It can call task.success() or task.fail() (even asynchronously)
                // to tell us whether it succeeded, so that we can reschedule the item or delete it.
                var retVal = this.config_.processorFn.call(null, task);

                // If processor function returns a promise, it does not need to call task.success()
                // or task.fail(). We will do that when the promise settles.
                if (retVal && typeof retVal['then'] === 'function') {
                    retVal.then(function(rv) {
                        task.success(rv);
                    }, function(err){
                        task.fail(err || new Error('Task Failed, but did not return a specific error'));
                    });
                }
            } catch (err) {
                // Consumer's processor method threw an exception, i.e. it failed. Schedule a retry.
                task.fail(err);
            }
        }
    }


    /**
     * If we encounter a future task when processing the queue, we need to revisit it at the
     * appointed time. If until then it does not drop out of the window, we will not get another
     * child_added event for it. The solution is to book a refresh of our query for the appointed
     * time.
     *
     * @param {number} dueAt The date/time the task is due to be executed. Numeric format.
     * @private
     */
    scheduleQueryRefresh_(dueAt) {

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

            log(`${this.config_.name}: Query will be refreshed at ${new Date(this.queryRefreshTime_)}`);
        }
    }


    /**
     * Cancels the scheduled query refresh.
     *
     * @private
     */
    cancelQueryRefresh_() {

        clearTimeout(this.queryRefreshHandle_);
        log(`${this.config_.name}: Query refresh cancelled at ${new Date(this.queryRefreshTime_)}`);

        this.queryRefreshHandle_ = null;
        this.queryRefreshTime_ = null;
    }


    /**
     * Refreshes or re-executes the Firebase query so that we receive child_added events for any
     * tasks we previously ignored because they were not due to be executed yet.
     *
     * @private
     */
    refreshQuery_() {

        log(`${this.config_.name}: Refreshing query ...`);

        this.stop_();
        this.start();

        log(`${this.config_.name}: Refreshed query`);
    }
}


module.exports = Worker;
