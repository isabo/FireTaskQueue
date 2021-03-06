# FireTaskQueue
A basic task queue for Node.js apps that use Firebase. I built it to make things simpler in the
early stages of developing apps that need a queue, but which could do without the complication of
introducing a separate queue service such as RabbitMQ at an early stage.

## Features
- Tasks can be submitted for immediate execution or scheduled for a specific time in the future.
- Tasks that fail are automatically retried at exponentially increasing intervals.
- You can define multiple queues, each with its own configuration and tasks.
- Pipelining: a task can complete and launch another task in one atomic operation.

## FYI
- A task is an object that holds information that is meaningful to your app. The object's properties
  and values must be compatible with what Firebase supports, i.e., values must be primitives.
- Tasks can be submitted for immediate execution or for execution at a specific time (i.e. delayed
  execution).
- Tasks are not guaranteed to be processed in the order they were submitted, but that is the general
  intention.
- If a task fails, it will be retried at exponentially increasing intervals up to a default of 1
  hour.
- It is possible, though unlikely, that a task will be executed more than once. Make your handlers
  idempotent.
- You can define multiple named queues. They each need their own FireTaskQueue instance to process
  their tasks.
- Currently, running more that one instance of FireTaskQueue for a specific named queue is not
  supported.

## Installation
```
npm install --save fire-task-queue
```

## Usage

### Schedule A Task
```js
var Firebase = require('firebase');
var FireTaskQueue = require('fire-task-queue');

// Where do we put the queues?
var queuesRef = new Firebase('https://myapp.firebaseio.com/queues');

// Create a queue instance.
var q = new FireTaskQueue('my_queue', queuesRef.child('myQueue'));

// Schedule a task for immediate execution.
var taskData = {
    a: 1,
    b: 'two'
};

q.scheduleTask(taskData).
    then(function(taskId) {
        // Task has been successfully scheduled.
    }, function(err) {
        // Failed to schedule the task.
    });

// Schedule a task for execution in 1 minute.
q.scheduleTask(taskData, Date.now() + 60000).
    then(...);

// Alternatively, there's a static method:
FireTaskQueue.scheduleTask('my_queue', {...task data...}, optionalDateOrTimestamp);
```

### Process Tasks
```js
q.start(function(task) {
    console.log('Processing ' + task.id);

    // You can even do something asynchronous, as long as you remember to call success(), or return
    // a promise which when fulfilled, indicates the end of the processing for that task.
    setTimeout(function() {
        task.success();
    }, 500);
});

// Alternatively, there's a static method:
FireTaskQueue.start('my_queue', function(task){...});
```

### Clean up before shutting down
```js
// Shut down our specific queue:
q.dispose();

// Shut down all queues:
FireTaskQueue.disposeAll();
```

### Prepare Your Firebase
It would be a good idea to provide some rules for the queue functionality. Here's what I use:
```js
"queues": {

    "$queueName": {

        /**
         * Only the server can read/write.
         */
        ".write": "auth !== null && auth.isSystem === true",
        ".read": "auth !== null && auth.isSystem === true",

        /**
         * Add an index to help sort by time.
         */
        ".indexOn": "_dueAt",

        /**
         * Generic task definition.
         */
        "$taskId": {

            /**
             * Must have a _dueAt property.
             */
            ".validate": "newData.hasChildren(['_dueAt'])",

            /**
             * When the task should be executed.
             */
            "_dueAt": {
                ".validate": "newData.exists() && newData.isNumber()"
            },

            /**
             * The number of failed attempts made to execute this task.
             */
            "_attempts": {
                ".validate": "newData.exists() && newData.isNumber() && newData.val() > 0"
            }
        }
    }
}
```
Of course, if clients are going to be enqueuing tasks, it would be advisable to tighten up the rules
by specifying the queues that clients can write to, and the properties that are relevant for each
queue.

## API Documentation

### FireTaskQueue
Represents a task queue. The queue can be monitored for tasks, and tasks can be scheduled on the
queue.

#### new FireTaskQueue(name, ref)

Creates a new queue instance.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| name | string | A name for the queue that can be used when invoking class methods instead of using an instance.|
| ref  | Firebase | Firebase ref under which this queue's data should be stored.|



#### q.scheduleTask(taskData, [when, [taskId, [replace]]])

Schedules a task for processing.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| taskData | Object | An object containing data that represents some work that needs to be done. |
| [when]   | Date or number | Optional. A Date instance or numeric timestamp that indicates the earliest time the task should be processed. |
| [taskId] | string | Optional. Allows you to specify your own ID for the task. Use this if you need to prevent redundant tasks from being created by logic that does not know if a task was already created elsewhere in the app. |
| [replace]| boolean | Optional. If you specify a value for *taskId*, this determines whether to replace an existing task with the specified ID, or to fail with an error of `FireTaskQueue.DuplicateIdError`. Default: *false*, i.e., do not replace an existing task.|

##### Returns
Promise.
Resolves to the ID of the newly created task, or is rejected with an error.
If rejected because `taskId` specified the ID of an existing task, and `replace` was `false` or
undefined, the error will be of type `FireTaskQueue.DuplicateIdError`.



#### q.start(callback, [parallelCount, [maxBackOff, [minBackOff]]])

Registers a callback function that will be called for each task in the queue at the appropriate time.
Currently, multiple workers are not supported so don't call this more than once per queue instance.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| callback | function(task) | A function that knows how to process a task that was scheduled. The function should accept a Task instance (see below). It can also return a Promise, which will determine whether the task is seen to be successful or is retried (see below).|
| [parallelCount] | number | Optional. The number of tasks that are allowed execute in parallel. |
| [maxBackOff] | number | Optional. The maximum interval, in microseconds, between retry attempts of failed tasks.|
| [minBackOff] | number | Optional. The minimum interval, in microseconds, between retry attempts of failed tasks.|

##### Indicate that Processing is Complete
FireTaskQueue assumes that your callback performs asynchronously. Therefore, you must indicate when
processing is complete, using any of the following:
- **Call *task.success()* or *task.fail()*.** The value that you provide to *fail()* will be
  stored in the task for debugging purposes.
- **Return a promise.** Processing is considered complete when the promise is fulfilled. If the
  promise is resolved, the task is considered to have been processed successfully and will be
  deleted. If the promise is rejected, the task is considered to have failed and will be retried.
  The value with which the promise is rejected will be stored in the task for debugging purposes.
- **Throw an exception, or allow one to be thrown**, so that the callback fails immediately. The
  task will be considered to have failed and will be retried. The details of the exception will be
  stored in the task for debugging purposes.



#### q.dispose()

Stops monitoring the queue and releases the memory used by the queue.
The unprocessed tasks remain in Firebase.



#### FireTaskQueue.scheduleTask(queueName, taskData, [when, [taskId, [replace]]])

Schedules a task for processing.
The static form of `q.scheduleTask()`.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| queueName | string | The name of the queue. If no such queue instance has been created, the call will return a rejected promise.|
| taskData | Object | An object containing data that represents some work that needs to be done. |
| [when]   | Date or number | Optional. A Date instance or numeric timestamp that indicates the earliest time the task should be processed. |
| [taskId] | string | Optional. Allows you to specify your own ID for the task. Use this if you need to prevent redundant tasks from being created by logic that does not know if a task was already created elsewhere in the app. |
| [replace]| boolean | Optional. If you specify a value for *taskId*, this determines whether to replace an existing task with the specified ID, or to fail with an error of `FireTaskQueue.DuplicateIdError`. Default: *false*, i.e., do not replace an existing task.|

##### Returns
Promise.
Resolves to the ID of the newly created task, or is rejected with an error.
If rejected because `taskId` specified the ID of an existing task, and `replace` was `false` or
undefined, the error will be of type `FireTaskQueue.DuplicateIdError`.



#### FireTaskQueue.get(queueName)

Returns the instance of the named queue, if it exists. Otherwise: undefined.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| queueName | string | The name of the queue. |



#### FireTaskQueue.start(queueRefOrName, callback, [parallelCount, [maxBackOff, [minBackOff]]])

Registers a callback function that will be called for each task in the queue at the appropriate time.
Currently, multiple monitors are not supported so dan't call this more than once per queue instance.
This is the static form of `q.start()`.

##### Arguments
| Name | Type | Description |
|------|------|-------------|
| queueRefOrName | string or Firebase | The name of an existing queue, or the Firebase reference of a queue. If a Firebase reference is supplied, the queue will be created if it does not yet exist. |
| callback | function(taskId, taskData, done) | A function that knows how to process a task that was scheduled. The function should accept the following arguments: *taskId* (a string), *taskData* (an Object), and *done* (a function). See below for usage of *done()*.
| [parallelCount] | number | Optional. The number of tasks that are allowed execute in parallel. |
| [maxBackOff] | number | Optional. The maximum interval, in microseconds, between retry attempts of failed tasks.|
| [minBackOff] | number | Optional. The minimum interval, in microseconds, between retry attempts of failed tasks.|

##### Indicate that Processing is Complete
FireTaskQueue assumes that your callback performs asynchronously. Therefore, you must indicate when
processing is complete, using any of the following:
- **Call *task.success()* or *task.fail()*.** The value that you provide to *fail()* will be
  stored in the task for debugging purposes.
- **Return a promise.** Processing is considered complete when the promise is fulfilled. If the
  promise is resolved, the task is considered to have been processed successfully and will be
  deleted. If the promise is rejected, the task is considered to have failed and will be retried.
  The value with which the promise is rejected will be stored in the task for debugging purposes.
- **Throw an exception, or allow one to be thrown**, so that the callback fails immediately. The
  task will be considered to have failed and will be retried. The details of the exception will be
  stored in the task for debugging purposes.



#### FireTaskQueue.disposeAll()

Stops monitoring all queues and releases the memory used by the queues.
The unprocessed tasks remain in Firebase.
Call this when shutting down.



### FireTaskQueue.Task

A Task instance is passed to the processing function.

#### task.id
The ID of the task.

#### task.data
The data with which the task was scheduled.

#### task.dueAt
The UTC timestamp at which the task was scheduled to be executed.

#### task.attempts
The number of previous (failed) attempts to execute the task.

#### task.lastFailureReason
The reason for the last failure. This is from one of these possibilities:
1. The value passed to `task.fail()` by a previous invocation.
2. The value with which the promise returned by a previous invocation was rejected.
3. The error which was thrown by a previous invocation.

#### task.success([queueName, taskData, [dueAt, [taskId]]])
Call this to indicate that the task has been processed successfully.
If arguments are supplied, a new task will be scheduled in a single atomic operation with completing
the current task.
##### Arguments
| Name | Type | Description |
|------|------|-------------|
| queueName | string | The name of the queue on which to create the new task. If undefined, it will be the same queue as the current task.|
| taskData | Object | An object containing data that represents some work that needs to be done. |
| [dueAt]   | Number | Optional. A numeric timestamp that indicates the earliest time the task should be processed. |
| [taskId] | string | Optional. Allows you to specify your own ID for the task. Use this if you need to prevent redundant tasks from being created by logic that does not know if a task was already created elsewhere in the app. |

Note that if you supply `taskId`, the new task will automatically replace an existing task which has
the same ID.

#### task.fail(reason, [data])
Call this to indicate that the task was not processed, and should be retried.
##### Arguments
| Name | Type | Description |
|------|------|-------------|
| reason | string, number, boolean, Object, Error | Something that indicates what went wrong. |
| [data] | Object | Optional. If supplied, this data object will replace the original one. This allows state information to be saved so that the next attempt can pick up where this attempt left off.



### FireTaskQueue.DuplicateIdError

This error is the rejected value when `scheduleTask()` fails because there is already a task with
the specified ID.



## Developers
This section is relevant if you want to fix a bug or develop a new feature.

### Build
It's not really building in this case, just performing a static analysis of the source code.
This requires a JVM to have been installed on your machine.
```
npm run build
```

### Test
- You need to have a Firebase instance that can be written to for testing. The test data will be
  written under `/queues/`.
- Ensure that `FTQ_FIREBASE_NAME` and `FTQ_FIREBASE_TOKEN` environment variables have been set to
  appropriate values for accessing your Firebase instance.

```
npm test
```
