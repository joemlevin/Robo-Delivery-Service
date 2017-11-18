//
// Copyright (c) 2015-2017 The Regents of the University of California.
// All rights reserved.
//
// Permission is hereby granted, without written agreement and without
// license or royalty fees, to use, copy, modify, and distribute this
// software and its documentation for any purpose, provided that the above
// copyright notice and the following two paragraphs appear in all copies
// of this software.
//
// IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY
// FOR DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES
// ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF
// THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE POSSIBILITY OF
// SUCH DAMAGE.
//
// THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
// INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE
// PROVIDED HEREUNDER IS ON AN "AS IS" BASIS, AND THE UNIVERSITY OF
// CALIFORNIA HAS NO OBLIGATION TO PROVIDE MAINTENANCE, SUPPORT, UPDATES,
// ENHANCEMENTS, OR MODIFICATIONS.
//

/** The is the implementation of another deterministic temporal semantics.
 * 
 *  This module provides Accessors with deterministic temporal semantics, 
 *  that are aligned with Cape Code's semantics. This module is to be explored 
 *  by commonHost, so that any swarmlet host will enjoy these features.
 *  For this, accessors calls to setTimeout() or setInterval() are binded, 
 *  respectively, to this module's setTioumetDet() and setIntervalDet(). It is 
 *  guaranteed that only one timeout (function provided by the host) is pending  
 *  at any time and that callbacks will be executing with respect to their  
 *  logical clock domains and their relative priority and/or arrival time.
 *  
 *  For this implementation, we assume that there is the physical time line, 
 *  together with many logical time lines. All time lines do not advance the same 
 *  way. Physical time is continuous and has the same rate, while logical time is 
 *  updated at particular instances.
 *  
 *  Each logical time line is associated with a 'labeled logical clock domains'
 *  (LLCD). This allows for defining and implementing logical simultaneity of 
 *  callbacks execution. 
 *
 *  The basic idea is to define each delayed callback with an LLCD. Two delayed 
 *  callbacks with the same LLCD share the same logical time line. If they have
 *  the same logical time execution, then they will execute atomically one after 
 *  another, such that their arrival order is respected. That is, if the instruction
 *  setInterval(F, T, 'A') was called before setInterval(G, T, 'A'), and no other
 *  action involving the LLCD 'A' has happened in between, then when F executes, it 
 *  will be immediately followed by G.  
 *  
 *  When a call to the binded setTimeout or setInterval occurs, then scheduling the 
 *  execution will depend on the LLCD. If it is a new one, then a new LLCD is created
 *  and its current logical time is set to the current physical time. However, if the 
 *  LLCD is already defined, then the current logical time of that clock domain is 
 *  used. In either cases, the callback will execute at its LLCD logical current time 
 *  plus the timeout. 

 *  Labeled logical clock domain are strings. However, if the programmer unintentionally
 *  or intentionally do not provide one, then a new anonymous clock domain is created 
 *  with its logical time origin set to the current real time (approximately). The new
 *  anonymous clock doamin is unique and is generated by incrementing defaultLabelIndex.
 *  An exception is that if llcd is not given and timeout is zero, then a single shared 
 *  zero-delay clock domain is used.
 *  This exception is used to request an execution as soon as possible, before any
 *  callbacks in other clock domains are invoked. If there are multiple such zero-timeout
 *  anonymous llcd callbacks, then the order of their invocation will be determined by
 *  their priority, if one is given, and by the order of the request, if no priority
 *  is given or if a priority matches another priority.   
 *
 *  This implementation was preceded by a another one that adopts a slightly different
 *  semantics for the execution. In the previous version, any two callbacks with the 
 *  same label execute starting from the same reference point in time. In addition,
 *  there are only two time lines: the physical one and the logical one. Therefore,
 *  delayed callbacks execute only with respect to the logical one. This way, the inter
 *  execution time is always respected. The drawback is that additional delays are 
 *  added.
 *  
 *  For the purpose of implementing temporal semantics, we record all delayed callBacks
 *  in the 'delayedCallbacks' object. This object is accessed by label. Within a 
 *  labeled object, we record the current logical execution time, and the group of 
 *  delayed callbacks having the same label. A new delayedCallback object is added 
 *  to delayedCallbacks, given its label. In addition, each new object is uniquely 
 *  identified by a number (generated by automatically incrementing cbIdentifier). 
 *  Consequently, the identifier reflects the order in which the calls to setTimeout 
 *  or setInterval occurred. This number is returned and is to be used for clearing 
 *  the corresponding timer. This happens each time setTimeoutDet() or seIntervalDet() 
 *  is called. 
 *  
 *  For the sake of any system that may need to define execution order based on 
 *  predefined/precomputed priorities, it is possible to pass the priority 
 *  as an argument to setTimeout or setInterval. Consequently, the third level of
 *  delayed callbacks ordering will be, first, based on priorities, then on arrival
 *  time (reflected by the identifiers). For the case of Accessors, the priority will
 *  be inherited from the accessor's priority (if defined).
 *  
 *  
 *  In order to make the process fast, the list 'callbackQueue' keeps an incremental 
 *  next execution time sorted list of pointers to the delayed callbacks. Pointers
 *  are objects with two attributes: the labeled clock domain and the identifier.
 *  This list, has three levels of sorting. The first one is obviously the execution
 *  time. If two or more callbacks have the same execution time, they are ordered by 
 *  their labels origin. This is the second level of sorting. Finally, the third one is 
 *  the callbacks ordering, reflected by the identifiers. 
 *  
 *  A delayed callback has the following attributes: 
 *   *  callbackFunction: the callback function, which will be invoked once or periodically,
 *      depending on the value of the repeat parameter.
 *   *  interval: The time until the first (or only) execution of the callback.
 *      This is a non-negative number interpreted as milliseconds
 *      (a negative number will be treated as zero).
 *      This is a logical time, relative to the current logical time of the llcd.
 *      If the llcd is null or has never before been created, then a new llcd will be
 *      created and its logical time will be set to (approximately) the current physical time.
 *   *  periodic: if set to true, the callback needs to execute every interval time,
 *      otherwise, it executes only once. A boolean specifying whether the callback should 
 *      be invoked just once (with value false) or repeatedly, periodically, until stopped 
 *      (with value true).
 *   *  nextExecutionTime: records the next time at which the callback should be
 *      executed.
 *   *  priority is an optional attribute for the priority over other delayed callbacks
 *      that use the same llcd and are scheduled to occur at the same logical time.
 *      This is either null or an integer, where a lower value means higher priority.
 *      If two priorities match, then the order of invocation matches the order in which
 *      requests are made (by calling this function).
 *   *  errorCallback is an optional attribute that provides a callback to execute in case
 *      the delayed callback's execution throws an error. If no callback is specified, then
 *      if the delayed callback throws an error, then the error message and stack trace
 *      will be printed to the console and execution will continue.
 *   *  doneCallback is an optional attricute that provides the callback to execute after 
 *      the delayed callback has executed successfully. If repeat is true, then this callback
 *      will be invoked after each successful invocation of of the callback argument function.
 *        
 *  Proof: Done! Using Real-Time Maude :-)
 *  
 *  @module @accessors-hosts/common/deterministicTemporalSemantics
 *  @author Chadlia Jerad and Edward A. Lee
 *  @version $$Id: deterministicTemporalSemantics.js 2017-05-03 11:11:30Z chadlia.jerad $$   
 */

// Save the default engine's setTimeout, setInterval, clearTimeout and clearInterval 
// in other varibales, so that they can be redefined later (see end of the file)
// var originalSetTimeout = setTimeout;
// var originalSetInterval = setInterval;
// var originalClearTimeout = clearTimeout;
// var originalClearInterval = clearInterval;

// This variable keeps track of all delayedCallback objects. These objects are accessed
// by the labeled logical clock domain and their unique identifier
var delayedCallbacks;

// A sorted list of (label/id) objects are in this variable. This enables fast
// execution, so that the implementation scales
var callbackQueue = [];

// Record the time of the next scheduled tick
var nextScheduledTick = Infinity;

// This variable uniquely identifies calls to setInterval and setTimeout
var cbIdentifier = 0;

// This variable identifies the physical setTimeout call point. This is useful for
// updating the next tick 
var tick;

// Default label index
var defaultLabelIndex = 0;

/** This function is to be binded to clearInterval() function. It clears the 
 *  periodic timer which identifier is given as parameter, by calling
 *  clearTick().
 *  
 *  @param cbId this parameter is required. It is the cbIndentifier.
 */
function clearIntervalDet(cbId){
    clearTick(cbId, true);
}

/** clearTick() parses delayedCallbacks in order to remove the one with the passed 
 *  id and periodicity. It is also deleted from callbackQueue.
 *  If the first argument, that is the identifier, is not a number, than no 
 *  need to parse.    
 *   
 *  @param cbId this parameter contains the callback identifier
 *  @param periodic boolean value: true if periodic (called from clearIntervalDet), 
 *          false otherwise
 */
function clearTick(cbId, periodic) {
    if (!delayedCallbacks || (callbackQueue.length === 0)) {
        return;
    }
    
    var label;
    var indexInCbQueue = -1;
    
    // Parse for the index in callbackQueue, and deduce the label
    for(var i = 0 ; i < callbackQueue.length ; i++) {
        if (callbackQueue[i].id === cbId) {
            indexInCbQueue = i;
            label = callbackQueue[i].label ;
            break;
        }
    }
    
    if (indexInCbQueue !== -1) {
        // console.log('index of id: ' + cbId + ' in callback queue is: ' +
        //      indexInCbQueue + ' label is: ' + label + ' del callbacks: ' + 
        //      delayedCallbacks[label][cbId]);

        // Delete from delayedCallbacks, if the same periodic value
        if (delayedCallbacks[label][cbId].periodic === periodic) {
            delete delayedCallbacks[label][cbId];
            
            // Delete from callbackQueue
            callbackQueue.splice(indexInCbQueue , 1);
            
            // Clean up delayedCallbacks
            if ((Object.size(delayedCallbacks[label]) === 2)) {
                delete(delayedCallbacks[label]);
                // Check if there are still callbacks in the list
                if (Object.size(delayedCallbacks) === 0) {
                    reset();
                }
            }
        }
    }
    
    // If no delayed callback to remove, then this is not an error! It may happen, for instance,
    // that a timer (call to this.setTimeout) has expired before calling clear. It may happen 
    // also to call clearTimeout or clearInterval with wrong arguments.
}

/** This function is to be binded to clearTimeout() function. It clears the 
 *  timeout timer which identifier is given as parameter, by calling
 *  clearTick().
 *  
 *  @param cbId this parameter is required. It is the callback indentifier of the one time delayed
 *   callback to clear.
 */
function clearTimeoutDet(cbId){
    clearTick(cbId, false);
}

/** Compute the next execution time to be scheduled. Since callbacks are sorted
 *  in callbackQueue in order of their next execution time, the next execution time 
 *  of the one on then the top of the list is returned. 
 *  
 *  @return the next execution time of the first callback in the sorted list
 */ 
function computeNextSceduledTick() {
    // Get the label and id of the first element in the sorted list
    var label = callbackQueue[0].label;
    var id = callbackQueue[0].id;
    
    return (delayedCallbacks[label][id].nextExecutionTime);
}

/** This function implements callbacks execution and update. It is called only by the
 *  host's setTimeout function. 
 *  All delayed callbacks with next execution time less than the current time will be 
 *  executing. Consequently, in case the system has cumulated some delay due, or example,
 *  to an over running program, all late callbacks will execute, but with respect to the 
 *  order and atomicity set by the definitions.
 *  Next, the list is cleaned from no-more triggerable callbacks. 
 *  And finally, the next tick is set.
 */
var executeAndSetNextTick = function() {
    // Handling a corner case: if somehow it happens that delayedCallbacks is empty
    if (!delayedCallbacks || (callbackQueue.length === 0)) {
        reset();
        return;
    }
    
    var currentTime = Date.now();
    
    while (nextScheduledTick <= currentTime) {
        
        // console.log('-------Execute: At logical time: ' + nextScheduledTick % 100000 
        //        + ' At real time: ' + Date.now() % 1000000 + ' size of queue: '+callbackQueue.length );
        
        // Execute callbacks
        executeCallbacks();
        
        // Check that there are still call backs in the list
        if (!delayedCallbacks || (callbackQueue.length === 0)) {
            reset();
            return;
        }
        
        // Update the next scheduled tick 
        nextScheduledTick = computeNextSceduledTick();
        
        // Upadte current time
        currentTime = Date.now();
    }
    
    // Handling a corner case: if somehow it happens that delayedCallbacks is empty
    if (!delayedCallbacks || (callbackQueue.length === 0)) {
        reset();
        return;
    }
    
    // Set the next Tick
    // tick = originalSetTimeout(executeAndSetNextTick, Math.max(nextScheduledTick - Date.now(), 0));
    tick = setTimeout(executeAndSetNextTick, Math.max(nextScheduledTick - Date.now(), 0));
};

/** This function executes delayed callback such that their next execution time
 *  is equal to the nextScheduledTick.
 *  It then updates the next execution time if the callback is periodic, and remove it 
 *  if not periodic. Labels are also deleted if the corresponding array is empty.
 */
function executeCallbacks() {
    var done = false;
    do {
        var key = callbackQueue[0].label;
        var id = callbackQueue[0].id;
        
        if (delayedCallbacks[key][id].nextExecutionTime === nextScheduledTick) {
            // console.dir(callbackQueue);
            // console.dir(delayedCallbacks);
            callbackQueue.splice (0, 1);

            // Update the current logical time of an LLCD 
            delayedCallbacks[key].currentLogicalTime = nextScheduledTick;
            
            // Call the callback function
            try {
                // console.log('--- execution delCB['+key+']['+id+']');
                
                delayedCallbacks[key][id].cbFunction.call();
                            
                // then reinitialize the remainingTime to the interval value.
                if (delayedCallbacks) {
                    if (delayedCallbacks[key]) {
                        if (delayedCallbacks[key][id]) {
                            // If doneCallback is defined, execute what should be done after a callback execution succeeds
                            if (delayedCallbacks[key][id].doneCallback) {
                                delayedCallbacks[key][id].doneCallback.call(this, id);
                            }
                            if (delayedCallbacks[key][id].periodic === true) {
                                delayedCallbacks[key][id].nextExecutionTime += delayedCallbacks[key][id].interval;
                                putInCallbackQueue(key, id);
                            } else {
                                // All the executed callbacks that are not periodic, need to be removed from the List.
                                delete(delayedCallbacks[key][id]);
                                
                                // If delayedCallback of the key label is empty, then remove it
                                if (Object.size(delayedCallbacks[key]) === 2) {
                                    delete(delayedCallbacks[key]);
                                    if (Object.size(delayedCallbacks) === 0) {
                                        reset();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('Error executing delayedCallbacks[' + key + '][' + id + ']...');
                // If an error is catched, then use the errorCallback, if provided, to handle this,
                // otherwise, just print an error message
                if (delayedCallbacks[key][id].errorCallback) {
                    delayedCallbacks[key][id].errorCallback.call(this, e);
                } else {
                    console.error('********************** error stack trace:');
                    var stack = e.stack.replace(/^[^\(]+?[\n$]/gm, '')
                        .replace(/^\s+at\s+/gm, '')
                        .replace(/^Object.<anonymous>\s*\(/gm, '{anonymous}()@')
                        .split('\n');
                    console.error(stack);
                    console.error('**********************');
                }

                delete(delayedCallbacks[key][id]);
                
                // If delayedCallback of the key label is empty, then remove it
                if (Object.size(delayedCallbacks[key]) === 2) {
                    delete(delayedCallbacks[key]);
                    if (Object.size(delayedCallbacks) === 0) {
                        reset();
                        return;
                    }
                }
            }
        } else if (delayedCallbacks[key][id].nextExecutionTime > nextScheduledTick) {
            done = true;
        } else {
            throw new Error('executeCallbacks(): Callbacks are not sorted!');
        }
    } while(!done && callbackQueue.length !== 0); 

    // Check if there are callbacks in the list
    if (Object.size(delayedCallbacks) === 0) {
        reset();
    }
}

/** callbackQueue variable keeps track of an ordered list of callbacks.
 *  This variable contains pointers to delayed callbacks, which are objects with two 
 *  attributes: the label and the id.
 *  
 *  This function performs a sorted insertion, given three levels of sorting. 
 *  The first one is the 'nextExecutionTime'. Then, when two or more callbacks have the 
 *  same nextExecutionTime,  other levels of sorting are considered:
 *   *  Second level of sorting: ascending order of labels (using the value of "origin")
 *   *  Third level: within the same label, delayed callbacks are ordered by priorities first,
 *      then by an ascending order of the callback identifiers. 
 *  
 *  @param label the labeled clock domain of the delayedCallback to add
 *  @param id the unique id of  of the delayedCallback to add
 */
function putInCallbackQueue(label, id) {
    // FIXME: The sorted insertion can be further improved for a more efficient execution, 
    // in terms of time.
    
    // Construct the object to add to the list
    var obj = {"label": label, "id": id};
    
    // Case if the list is already empty
    if (callbackQueue.length === 0) {
        callbackQueue.push(obj);
        return;
    }
    
    var index = 0;
    var labelInList, idInList;
    
    // Parse callbackQueue array looking for the index of insertion
    for (index = 0 ; index < callbackQueue.length ; index++) {
        labelInList = callbackQueue[index].label;
        idInList = callbackQueue[index].id;
        
        // Control point for consistency check between delayedCallbacks and callbackQueue
        if (delayedCallbacks[labelInList][idInList] === undefined) {
            throw new Error('putInCallbackQueue(' + label + ', ' + id +
                            '): delayedCallbacks[' + labelInList + '][' +
                            idInList + '] is undefined?  index was: ' + index);
        } 
        
        // First level of sorting: nextExecutionTime
        if (delayedCallbacks[labelInList][idInList].nextExecutionTime < delayedCallbacks[label][id].nextExecutionTime) {
            // Go to next element of array, until we reach the same nextExecutionTime or greater
            continue;
        } else if (delayedCallbacks[labelInList][idInList].nextExecutionTime > delayedCallbacks[label][id].nextExecutionTime) {
            // Case where delayedCallbacks[labelInList][idInList].nextExecutionTime > delayedCallbacks[label][id].nextExecutionTime
            // Then break the execution and add at that position
            break;
        } else {
            // This means that delayedCallbacks[labelInList][idInList].nextExecutionTime === delayedCallbacks[label][id].nextExecutionTime
            // Second level of sorting: LLCD's origin
            
            // If there is already callbacks with the same next execution time
            // Check first a sorted insertion w.r.t the label
            if (labelInList === label) {
                // Third level of sorting: 
                // Use of priorities and callback ids
                if (typeof delayedCallbacks[label][id].priority !== "undefined") {
                    // The callback to insert has priority (priority can be equal to 0. Then it is not undefined)
                    if (typeof delayedCallbacks[labelInList][idInList].priority !== "undefined") {
                        if (delayedCallbacks[label][id].priority === delayedCallbacks[labelInList][idInList].priority) {
                            // In case of identical priorities, use the identifiers to get the order
                            if (id < idInList) {
                                break;
                            } else {
                                // Continue parsing until the position is found.
                                continue;
                            }
                        } else if (delayedCallbacks[label][id].priority < delayedCallbacks[labelInList][idInList].priority) {
                            break;
                        } else {
                            continue;
                        }
                    } else {
                        break;
                    }
                } else {
                    // The callback has no priority 
                    if (typeof delayedCallbacks[labelInList][idInList].priority !== "undefined") {
                        // Callbacks that has priority attribute has more priority compared to
                        // those which do not have one
                        continue;
                    } else if (id < idInList) {
                        // If both callbacks do not have priority, then sort given the id
                        break;
                    } else {
                        // Continue parsing until the position is found.
                        continue;
                    }
                }
            } else if (delayedCallbacks[labelInList].origin < delayedCallbacks[label].origin) {
                // Go to next element of array, until we reach the same currentLogicalTime or greater
                continue;
            } else {
                // delayedCallbacks[labelInList].currentLogicalTime > delayedCallbacks[label].currentLogicalTime
                // Case where the label is not already scheduled at that time, and 
                // it must execute prior to the current one
                break;
            }
        }
    }
    
    callbackQueue.splice(index, 0, obj);
}

/** In case there are no more delayedCallbacks (that is when callbackQueue becomes
 *  empty or delayedCallbacks has no more callbacks, then reset all counter, identifiers,
 *  objects and lists. 
 */
function reset() {
    // Clear tick
    // originalClearTimeout(tick);
    clearTimeout(tick);
    
    // Make sure delayedCallbacks and callbackQueue are reset
    delayedCallbacks = null;
    callbackQueue = [];
    
    // Set initial values for nextScheduledTick, cbIdentifier and defaultLabelIndex 
    nextScheduledTick = Infinity;
    cbIdentifier = 0;
    defaultLabelIndex = 0;
}

/** Both, setIntervalDet and setTimeoutDet create a new delayed callback, compute the next
 *  execution time, add it to delayedCallbacks and to callbackQueue, and possibly update  
 *  the next tick. The only difference if that the first one creates a new delayed callback
 *  such that periodic attribute is set to true, while the second creates one with periodic 
 *  attribute set to false. The following function implements the core common behavior, 
 *  while setting periodic to the value it should be. Therefore, setIntervalDet and 
 *  setTimeoutDet just call this function with the right parameters.
 *  
 *  @param callback The callback function, which will be invoked once or periodically,
 *   depending on the value of the repeat parameter.
 *  @param timeout The time until the first (or only) execution of the callback.
 *   This is a non-negative number interpreted as milliseconds
 *   (a negative number will be treated as zero).
 *   This is a logical time, relative to the current logical time of the llcd.
 *   If the llcd is null or has never before been created, then a new llcd will be
 *   created and its logical time will be set to (approximately) the current physical time.
 *  @param repeat A boolean specifying whether the callback should be invoked just once
 *   (with value false) or repeatedly, periodically, until stopped (with value true).
 *   To stop it, call clearTick(), passing the returned handle.
 *  @param llcd An optional argument giving the labeled logical clock domain
 *   label as a string. If no llcd argument is given (the argument is null or undefined),
 *   then a new anonymous clock domain is created with its logical time origin set to the
 *   current real time (approximately). An exception is that if llcd is not given and
 *   timeout is zero, then a single shared zero-delay clock domain is used.
 *   This exception is used to request an execution as soon as possible, before any
 *   callbacks in other clock domains are invoked. If there are multiple such zero-timeout
 *   anonymous llcd callbacks, then the order of their invocation will be determined by
 *   their priority, if one is given, and by the order of the request, if no priority
 *   is given or if a priority matches another priority.
 *  @param priority An optional argument for the priority over other delayed callbacks
 *   that use the same llcd and are scheduled to occur at the same logical time.
 *   This is either null or an integer, where a lower value means higher priority.
 *   If two priorities match, then the order of invocation matches the order in which
 *   requests are made (by calling this function).
 *  @param errorCallback An optional argument that provides a callback to execute in case
 *   the delayed callback's execution throws an error. If no callback is specified, then
 *   if the delayed callback throws an error, then the error message and stack trace
 *   will be printed to the console and execution will continue.
 *  @param doneCallback An optional argument that provides the callback to execute after 
 *   the delayed callback has executed successfully. If repeat is true, then this callback
 *   will be invoked after each successful invocation of of the callback argument function.
 *  @return An integer that is the unique ID of the new delayed callback.
 */
function setDelayedCallback(callback, timeout, repeat, llcd, priority, errorCallback, doneCallback) {
    // Construct a new object
    var newDelayedCallback = {};
    newDelayedCallback.cbFunction = callback;
    newDelayedCallback.interval = timeout;
    newDelayedCallback.periodic = repeat;
    
    // FIXME: Set a control step for the last 4 parameters
    
    // Check if a labeled clock domain has been provided, otherwise use the default one
    var label;
    if (!llcd || llcd == null || typeof(llcd) !== 'string') {
        if (timeout === 0) {
            // Default LLCD for any delayed callback with timeout 0 that is given without
            // an explicitly different LLCD
            label = 'zeroTimeoutLabel';
        } else {
            label = ++defaultLabelIndex;
        }
    } else {
        label = llcd;
    }

    // Possibly set the priority, errorCallback and doneCallback
    if (priority !== null && typeof(priority) == 'number') {
        newDelayedCallback.priority = priority;
    }
    if (errorCallback && typeof(errorCallback) == 'function') {
        newDelayedCallback.errorCallback = errorCallback;  
    }
    if (doneCallback && typeof(doneCallback) == 'function') {
        newDelayedCallback.doneCallback = doneCallback;  
    }

    // Generate a new identifier
    cbIdentifier++;
    
    // If the delayedCallbacks object was empty, then create the object
    if (!delayedCallbacks) {
        delayedCallbacks = {};
    }
    
    // If this is a new label, then create a new LLCD and set the current logical time to the 
    // current physical time
    if (!delayedCallbacks[label]) {
        delayedCallbacks[label] = {};
        if (label == 'zeroTimeoutLabel') {
            delayedCallbacks[label].currentLogicalTime = 0;
            delayedCallbacks[label].origin = 0;               
        } else {
            delayedCallbacks[label].currentLogicalTime = Date.now();
            delayedCallbacks[label].origin = delayedCallbacks[label].currentLogicalTime;
        }
    }
    
    // Set the next execution time of the new callback to the current logical time of the LLCD 
    // and add the timeout
    newDelayedCallback.nextExecutionTime = delayedCallbacks[label].currentLogicalTime + timeout;
    
    // Add the new delayed callback 
    delayedCallbacks[label][cbIdentifier] = newDelayedCallback;
    
    // Schedule the new delayed callback
    putInCallbackQueue(label, cbIdentifier);
    
    // Update the next tick if necessary
    if (nextScheduledTick > newDelayedCallback.nextExecutionTime) {
        // originalClearTimeout(tick);
        clearTimeout(tick);
        nextScheduledTick = newDelayedCallback.nextExecutionTime;
        // tick = originalSetTimeout(executeAndSetNextTick, Math.max(nextScheduledTick - Date.now(), 0));
        tick = setTimeout(executeAndSetNextTick, Math.max(nextScheduledTick - Date.now(), 0));
    }
    
    // return the callback identifier, useful for clearInterval
    return cbIdentifier;
}

/** This function is to be binded to setInterval() function. It calls setDelayedCallback
 *  since the core function is the same as SetTimeoutDet. After the new delayedCallback 
 *  is constructed, it is added to delayedCallbacks and to callbackQueue. If needed, the 
 *  next tick is updated. The returned value is the unique id of the delayed callback.
 *      
 *  @param callback The callback function, which will be invoked once or periodically,
 *   depending on the value of the repeat parameter.
 *  @param timeout The time until the first (or only) execution of the callback.
 *   This is a non-negative number interpreted as milliseconds
 *   (a negative number will be treated as zero).
 *   This is a logical time, relative to the current logical time of the llcd.
 *   If the llcd is null or has never before been created, then a new llcd will be
 *   created and its logical time will be set to (approximately) the current physical time.
 *  @param llcd An optional argument giving the labeled logical clock domain
 *   label as a string. If no llcd argument is given (the argument is null or undefined),
 *   then a new anonymous clock domain is created with its logical time origin set to the
 *   current real time (approximately). An exception is that if llcd is not given and
 *   timeout is zero, then a single shared zero-delay clock domain is used.
 *   This exception is used to request an execution as soon as possible, before any
 *   callbacks in other clock domains are invoked. If there are multiple such zero-timeout
 *   anonymous llcd callbacks, then the order of their invocation will be determined by
 *   their priority, if one is given, and by the order of the request, if no priority
 *   is given or if a priority matches another priority.
 *  @param priority An optional argument for the priority over other delayed callbacks
 *   that use the same llcd and are scheduled to occur at the same logical time.
 *   This is either null or an integer, where a lower value means higher priority.
 *   If two priorities match, then the order of invocation matches the order in which
 *   requests are made (by calling this function).
 *  @param errorCallback An optional argument that provides a callback to execute in case
 *   the delayed callback's execution throws an error. If no callback is specified, then
 *   if the delayed callback throws an error, then the error message and stack trace
 *   will be printed to the console and execution will continue.
 *  @param doneCallback An optional argument that provides the callback to execute after 
 *   the delayed callback has executed successfully. If repeat is true, then this callback
 *   will be invoked after each successful invocation of of the callback argument function.
 *  @return An integer that is the unique ID of the new delayed callback
 */
 function setIntervalDet(callback, timeout, llcd, priority, errorCallback, doneCallback) {
    // Throw an error if setInterval is called with timeout 0
    // Since this may lead to a dangerous behavior
    if (timeout === 0) {
        throw new Error('setInterval(): timeout zero is not allowed!');
    }
    return setDelayedCallback(callback, timeout, true, llcd, priority, errorCallback, doneCallback);
}

/** This function is to be binded to setTimeout() function. It calls setDelayedCallback
 *  since the core function is the same as SetIntervalDet. After the new delayedCallback 
 *  is constructed, it is added to delayedCallbacks and to callbackQueue. If needed, the 
 *  next tick is updated. The returned value is the unique id of the delayed callback.  
 *    
 *  @param callback The callback function, which will be invoked once or periodically,
 *   depending on the value of the repeat parameter.
 *  @param timeout The time until the first (or only) execution of the callback.
 *   This is a non-negative number interpreted as milliseconds
 *   (a negative number will be treated as zero).
 *   This is a logical time, relative to the current logical time of the llcd.
 *   If the llcd is null or has never before been created, then a new llcd will be
 *   created and its logical time will be set to (approximately) the current physical time.
 *  @param repeat A boolean specifying whether the callback should be invoked just once
 *   (with value false) or repeatedly, periodically, until stopped (with value true).
 *   To stop it, call clearTick(), passing the returned handle.
 *  @param llcd An optional argument giving the labeled logical clock domain
 *   label as a string. If no llcd argument is given (the argument is null or undefined),
 *   then a new anonymous clock domain is created with its logical time origin set to the
 *   current real time (approximately). An exception is that if llcd is not given and
 *   timeout is zero, then a single shared zero-delay clock domain is used.
 *   This exception is used to request an execution as soon as possible, before any
 *   callbacks in other clock domains are invoked. If there are multiple such zero-timeout
 *   anonymous llcd callbacks, then the order of their invocation will be determined by
 *   their priority, if one is given, and by the order of the request, if no priority
 *   is given or if a priority matches another priority.
 *  @param priority An optional argument for the priority over other delayed callbacks
 *   that use the same llcd and are scheduled to occur at the same logical time.
 *   This is either null or an integer, where a lower value means higher priority.
 *   If two priorities match, then the order of invocation matches the order in which
 *   requests are made (by calling this function).
 *  @param errorCallback An optional argument that provides a callback to execute in case
 *   the delayed callback's execution throws an error. If no callback is specified, then
 *   if the delayed callback throws an error, then the error message and stack trace
 *   will be printed to the console and execution will continue.
 *  @param doneCallback An optional argument that provides the callback to execute after 
 *   the delayed callback has executed successfully. If repeat is true, then this callback
 *   will be invoked after each successful invocation of of the callback argument function.
 *  @return An integer that is the unique ID of the new one time delayed callback.
 */
function setTimeoutDet(callback, timeout, llcd, priority, errorCallback, doneCallback) {
    // Just call setDelayedCallback and return
    return setDelayedCallback(callback, timeout, false, llcd, priority, errorCallback, doneCallback);
}

/** This function is used to return the number of an object entries.
 *  It is to be used to compute the number of labels in delayedCallbacks.
 *  @param obj the object. In this case: delayedCallbacks
 *  @return size the number of entries in delayedCallbacks
 */
Object.size = function(obj) {
    var size = 0, key;
    
    if (obj === null) {
        return 0;
    }
    
    for (key in obj) {
        if (obj.hasOwnProperty(key)) size++;
    }
    return size;
};

// Redirecting setTimeout, setInterval, clearTimeout, clearInterval to the 
// deterministic ones
// setTimeout = setTimeoutDet;
// setInterval = setIntervalDet;
// clearInterval = clearIntervalDet;
// clearTimeout = clearTimeoutDet;

///////////////////////////////////////////////////////////////////
//// Exports

exports.setTimeoutDet = setTimeoutDet;
exports.clearTimeoutDet = clearTimeoutDet;
exports.setIntervalDet = setIntervalDet;
exports.clearIntervalDet = clearIntervalDet;
