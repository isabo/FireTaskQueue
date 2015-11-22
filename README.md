# FireTaskQueue
A basic task queue for Firebase apps. I built it to make things simpler in early stages of working
on apps that need a queue, but don't need the complication of introducing a separate queue service
such as RabbitMQ at an early stage.

## Rules
- A task is an object that holds information that is meaningful to your app. The object's properties
  must be storable in Firebase.
- Tasks can be submitted for immediate execution or for execution at a specific time (i.e. delayed
  execution).
- Tasks are not necessarily processed in the order they were submitted, but that is the general
  intention.
- Tasks can only have a single status - unprocessed. They are deleted as soon as they are processed.
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

## Building
It's not really building in this case, just performing a static analysis of the source code.
```
npm run build
```

## Testing
Ensure that `FIREBASE_NAME` and `FIREBASE_TOKEN` environment variables have been set to appropriate
values for accessing your Firebase instance.
Then run:
```
npm test
```
