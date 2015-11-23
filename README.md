# FireTaskQueue
A basic task queue for Firebase apps. I built it to make things simpler in the early stages of
developing apps that need a queue, but which could do without the complication of introducing a
separate queue service such as RabbitMQ at an early stage.

## Rules
- A task is an object that holds information that is meaningful to your app. The object's properties
  must be storable in Firebase.
- Tasks can be submitted for immediate execution or for execution at a specific time (i.e. delayed
  execution).
- Tasks are not necessarily processed in the order they were submitted, but that is the general
  intention.
- Tasks cannot have multiple user-defined statuses. They are either in the queue, i.e. not yet
  processed, or are not in the queue, i.e. processed successfully then deleted.
- It is possible, though unlikely, that a task will be executed more than once. Make your handlers
  idempotent.
- You can define multiple named queues. They each need their own FireTaskQueue instance to process
  their tasks.
- Currently, running more that one instance of FireTaskQueue for a specific named queue is not
  supported.

## Installation
```
npm install --save isabo/FireTaskQueue
```

## Usage

### Schedule A Task
```js
var Firebase = require('firebase');
var FireTaskQueue = require('fire-task-queue');

var queuesRef = new Firebase('https://myapp.firebaseio.com/queues');

// Create a queue instance.
var q = new FireTaskQueue('my_queue', queuesRef.child('myQueue'));

// Schedule a task for immediate execution.
q.schedule({... task data ...}).
    then(function(taskId) {
        // Task has been successfully scheduled.
    }, function(err) {
        // Failed to schedule the task.
    });

// Schedule a task for execution in 1 minute.
q.schedule({... task data ...}, Date.now() + 60000).
    then(...);

// Alternatively...
FireTaskQueue.schedule('my_queue', {...task data...}, optionalDateOrTimestamp);
```

### Monitor and Process Tasks
```js
q.monitor(function(taskId, taskData, done) {
    console.log('Processing ' + taskId);

    // You can even do something asynchronous, as long as you remember to call done().
    setTimeout(function() {
        done(true);
    }, 500);
});

// Alternatively ...
FireTaskQueue.monitor('my_queue', function(taskId, taskData, done){...});
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

## Developers

#### Build
It's not really building in this case, just performing a static analysis of the source code.
```
npm run build
```

### Test
Ensure that `FIREBASE_NAME` and `FIREBASE_TOKEN` environment variables have been set to appropriate
values for accessing your Firebase instance.
Then run:
```
npm test
```
