/** 
 * @fileoverview This file contains seperate store implementations, that extend
 * the basic Backbone.sync method.
 *
 * @author Simon Schmidt simon-schmidt@alarie.de
 * @version 0.1 
 */

/*global window, Backbone, _, $ */

var Store, LocalStorage, RemoteStorage;

/**
 * Backbone.localStorage implementation by jeromegn.
 * https://github.com/jeromegn/Backbone.localStorage
 */
function S4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}

function guid() {
    return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}

Store = function (name) {
    this.name = name;
    var store = window.localStorage.getItem(this.name);
    this.data = (store && JSON.parse(store)) || {};
};

_.extend(Store.prototype, {

    save : function () {
        window.localStorage.setItem(this.name, JSON.stringify(this.data));
    },
   
    create : function (model) {
        if (!model.id) {
            model.id = model.attributes.id = guid();
        }
        this.data[model.id] = model;
        this.save();
        return model;
    },
   
    update : function (model) {
        this.data[model.id] = model;
        this.save();
        return model;
    },
   
    find : function (model) {
        return this.data[model.id];
    },
   
    findAll : function () {
        return _.values(this.data);
    },
   
    destroy : function (model) {
        delete this.data[model.id];
        this.save();
        return model;
    }

});

LocalStorage = {
    sync : function (method, model, options) {
        var resp,
            store = model.localStorage || model.collection.localStorage;
    
        switch (method) {
        case "read":    
            resp = model.id ? store.find(model) : store.findAll(); 
            break;
        case "create":  
            resp = store.create(model);                            
            break;
        case "update":  
            resp = store.update(model);                            
            break;
        case "delete":  
            resp = store.destroy(model);                           
            break;
        }
    
        if (resp) {
            options.success(resp);
        } else {
            options.error("Record not found");
        }
    }
};


/**
 * Wrapps around the original Backbone.sync.
 * Enhances it with a global error handler for 403 (User not logged in) errors,
 * that should be triggered if a request was fired onto a resource for which
 * the user had to be logged in.
 * @class RemoteStorage
 * @requires Backbone 
 */
RemoteStorage = {
    _globalSettings : {},

    /**
     * The original Backbone.sync method, that this implementation is going to
     * extend.
     * @private
     * @property
     * @type Function
     */
    _origSync : Backbone.sync,
    
    /**
     * Determines if the system is currently in login phase. If so, queue all
     * following ajax requests onto the requestQueue.
     * @private
     * @property
     * @type Boolean
     */
    _loginPhase : false,

    /**
     * Handle authorization errors. This is called if the server responds with
     * an http status code 401.
     * @param {Object} resp The response from the server.
     * @param {Object} requestData A hash containing all data that was used in
     * this request. Useful for queueing the request for later retry.
     */
    handleAuthorizationError : function (resp, requestData) {
        var that = this;
        
        this._requestQueue.push(requestData);

        // in case this error occours and we are not in login phase, switch to
        // the login phase and trigger the "loginrequired" event on the
        // Backbone.sync function object. Bind to this event in your view that
        // and handle the login process there. While we are in loginPhase, all
        // subsequent requests will be saved to the requestQueue.
        if (!this._loginPhase) {
            this._loginPhase = true;
            
            Backbone.sync.trigger("loginrequired", {
                errorData : resp,
                retryCallback : function () {
                    RemoteStorage._flush();
                }
            });
        }
    },
    
    /**
     * Queue that holds all requests in the order they were submitted.
     * @private
     * @property
     * @type Array
     */
    _requestQueue : [],
    
    /**
     * Flushes the request queue. First disables the login phase, then steps
     * through the request queue from the oldest to the youngest request and
     * firest them.
     * @private
     * @function
     */
    _flush : function () {
        this._loginPhase = false;  
        this._requestQueue.reverse();
        var itm;
        while ((itm = this._requestQueue.pop())) {
            RemoteStorage.sync(itm.method, itm.model, itm.options);    
        }
    },

    /**
     * Performs the sync method. Overwrites Backbone.sync. It adds an extra
     * error callback that wraps around possibly existing ones. This error
     * handler checks for 403 (User not logged in) errors. If such an error
     * occours, and the <code>responseText</code> of the request can be
     * transformed to an object width a <code>code</code> property with the
     * value 100, then all subsequent ajax requests will be queued up.
     * On the first occourence of the 403 error the <code>loginPhase</code>
     * property will be set to true, and an <code>loginrequired</code> event
     * will be fired on the document body element. The event object contains an
     * <code>retryCallback</code>, that is to be called once a user was
     * successfuly logged in.
     * The <code>retryCallback</code> triggers the flushing of the request queue.
     * @param {String} method The crud method to be performed.
     * @param {Backbone.Model} model The model that triggered this sync.
     * @param {Object} options The options to be handed on to the $.ajax method.
     */
    sync : function (method, model, options) {
        options = options || {};
        
        var that = this,
            error = options.error,
            worker,
            params,

            requestData = {
                method : method,
                model : model,
                options : options
            };

        
        options.error = function (resp) {
            var err = {};

            try {
                err = JSON.parse(resp.responseText);
            }
            catch (ex) {
                console.log("No valid json: " + resp.responseText, arguments, method, model, options);
            }

            // HTTP status code 401: Unauthorized
            if (resp.status === 401) {
                that.handleAuthorizationError(resp, requestData);
            }

            error(resp);
        };

        // If the request is not forced (ignores the login phase) and we 
        // are in the loginPhase, queue the request for later retry.
        if (!options.forced && this._loginPhase) {
            this._requestQueue.push(requestData);

            return; 
        }
 
        RemoteStorage._origSync(method, model, options);
    }
};

/**
 * Overwrites the original Backbone.sync with a helper function, that decides
 * whether a model should use the remote storage system, or a local storage.
 * @param {String} method The crud method to be performed.
 * @param {Backbone.Model} The model that triggered this sync.
 * @param {Object} options The options to be handed on to the $.ajax method.
 * @function
 */
Backbone.sync = function (method, model, options) {
    // In case there is both a local storage and a url defined, check the
    // options hash. 
    // Fallback to remote storage
    if ((model.localStorage || (model.collection && model.collection.localStorage)) &&
        (model.urlRoot || (model.collection && model.collection.url))) {
      
        if (options.location === "local") {
            LocalStorage.sync(method, model, options);   
        }
        else {
            RemoteStorage.sync(method, model, options);   
        }
    }
    // If there is just a local storage defined, save to local storage
    else if (model.localStorage || (model.collection && model.collection.localStorage)) {
        LocalStorage.sync(method, model, options);
    }
    // Otherwise trust on a remote storage
    else {
        RemoteStorage.sync(method, model, options);
    }
};

/**
 * Set global headers for the sync function. Useful for setting headers like
 * the Authorization-header. 
 * Maps on jQuery's $.ajaxSettings function.
 * @param {Object} headers The headers to set.
 */
Backbone.sync.setGlobalHeaders = function (headers) {
    $.ajaxSettings(headers);
};


// Enhance the Backbone.sync function object with Backbone.Events methods.
_.extend(Backbone.sync, Backbone.Events);

