'use strict';


/**
 * Config settings for a queue instance. This is used by the worker and by the task.
 */
class Config {

    /**
     * @param {string} name The name of the queue.
     * @param {!Firebase} ref The location of the queue in Firebase.
     */
    constructor(name, ref) {

        /**
         * The name of the queue -- used for logging.
         *
         * @type {string}
         * @private
         */
        this.name_ = name;

        /**
         * The location of the queue in Firebase.
         *
         * @type {!Firebase}
         * @private
         */
        this.ref_ = ref;

        /**
         * A consumer-supplied function that processes a task from the queue.
         *
         * @type {Function}
         */
        this.processorFn_;

        /**
         * The number of tasks we can process in parallel.
         *
         * @type {number}
         * @private
         */
        this.parallelCount_ = DEFAULT_PARALLEL_COUNT;

        /**
         * The minimum time (milliseconds) to wait before reattempting to process a task after
         * processing failed.
         *
         * @type {number}
         * @private
         */
        this.minBackOff_ = DEFAULT_MIN_FAILURE_BACKOFF;

        /**
         * The maximum time (milliseconds) to wait before reattempting to process a task after
         * processing failed.
         *
         * @type {number}
         * @private
         */
        this.maxBackOff_ = DEFAULT_MAX_FAILURE_BACKOFF;
    }


    get name() {
        return this.name_;
    }


    get ref() {
        return this.ref_;
    }


    /**
     * @param {Function} fn
     */
    set processorFn(fn) {
        this.processorFn_ = fn;
    }


    /**
     * @return {Function}
     */
    get processorFn() {
        return this.processorFn_;
    }


    /**
     * @param {number} value
     */
    set parallelCount(value) {
        this.parallelCount_ = value;
    }


    /**
     * @return {number}
     */
    get parallelCount() {
        return this.parallelCount_;
    }


    /**
     * @param {number} value
     */
    set minBackOff(value) {
        this.minBackOff_ = value;
    }


    /**
     * @return {number}
     */
    get minBackOff() {
        return this.minBackOff_;
    }


    /**
     * @param {number} value
     */
    set maxBackOff(value) {
        this.maxBackOff_ = value;
    }


    /**
     * @return {number}
     */
    get maxBackOff() {
        return this.maxBackOff_;
    }
}


/**
 * The default number of tasks we allow to be executed in parallel.
 *
 * @const {number}
 */
const DEFAULT_PARALLEL_COUNT = 5;


/**
 * The default minimum time (milliseconds) to wait before reattempting to process a task after
 * processing failed.
 *
 * @const {number}
 */
const DEFAULT_MIN_FAILURE_BACKOFF = 250;


/**
 * The default maximum time (milliseconds) to wait before reattempting to process a task after
 * processing failed.
 *
 * @const {number}
 */
const DEFAULT_MAX_FAILURE_BACKOFF = 3600000; // 1 hour.


module.exports = Config;
