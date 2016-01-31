'use strict';


/**
 * Standard logging method.
 *
 * @param {...} var_args
 * @private
 */
function log(var_args) {

    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift(LOG_PREFIX);
    console.log.apply(console, args);
}


/**
 * @type {string}
 */
const LOG_PREFIX = 'FireTaskQueue:';



module.exports = {log: log}
