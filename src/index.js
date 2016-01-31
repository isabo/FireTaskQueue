'use strict';

/**
 * Wire everything up.
 */
var FireTaskQueue = require('./queue');
FireTaskQueue.DuplicateIdError = require('./task').DuplicateIdError;


module.exports = FireTaskQueue;
