'use strict';


/**
 * A registry of all queue instances by their names.
 */
class Registry {


    /**
     * Registers a queue. Throws an exception if a duplicate is being created.
     *
     * @param {!Queue} queue
     */
    static register(queue) {

        var name = queue.name;
        if (!Registry.get(name)) {
            Registry.instances_[name] = queue;
        } else {
            throw new Error('A queue with that name already exists');
        }
    }


    /**
     * Removes a queue from the registry. No error is thrown if the queue did not exist.
     *
     * @param {!Queue} queue
     */
    static unregister(queue) {

        var name = queue.name;
        delete Registry.instances_[name];
    }


    /**
     * Returns the instance of the named queue.
     *
     * @param {string} name The name of the queue.
     * @return {!Queue|undefined}
     */
    static get(name) {

        return Registry.instances_[name];
    }


    /**
     * Returns all the queue names.
     *
     * @return {!Array<string>}
     */
    static getNames() {

        return Object.keys(Registry.instances_);
    }

}


/**
 * A map of name:Queue instance.
 *
 * @type {!Object<string,!Queue>}
 * @private
 */
Registry.instances_ = {}


module.exports = Registry;
