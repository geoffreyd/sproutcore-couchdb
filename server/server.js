// ========================================================================
// SproutCore
// copyright 2006-2008 Sprout Systems, Inc.
// ========================================================================

require('core') ;

SC.URL_ENCODED_FORMAT = 'url-encoded' ;
SC.JSON_FORMAT = 'json';

/**
  The Server object knows how to send requests to the server and how to
  get things back from the server.  It automatically handles situations
  such as 304 caching and queuing requests to send to the server later if
  the computer becomes disconnected from the internet.

  The Server object is designed to work with a resource oriented application.
  That is, you do someting like this:

  Server.request('resource','verb',{ parameters })
  or
  Server.create('resource',{ parameters })
  Server.refresh('resource',{ parameters })
  Server.update('resource',{ parameters })
  Server.destroy('resource',{ parameters })

  parameters include:
  onSuccess -- passes back returned text
  onFailure --


  @see SC.Record.refresh
  @see SC.Record.commit --> create/update
  @see SC.Record.destroy
**/
SC.Server = SC.Object.extend({

  // Set this to the prefix for your app.  Server will use this to convert
  // record_type properties into recordTypes.
  prefix: null,

  // Set this string to the format to be used to set your resource and verb.
  urlFormat: '/%@/%@',

  // Set this string to either rails or json to set the post transport protocol
  postFormat: SC.URL_ENCODED_FORMAT,

  // Set this string to true when escaping the JSON string is necessary
  escapeJSON: true,

  // Global server handlers you can initialize when creating this server.
  // If set, they will be called after each request.
  onSuccess: null,
  onFailure: null,

  // call this in your main to preload any data sent from the server with the
  // initial page load.
  preload: function(clientData) {
    if ((!clientData) || (clientData.size == 0)) return ;
    this.refreshRecordsWithData(clientData,SC.Record,null,false);
  },

  /**
    This is the root method for accessing a server resource.  Pass in the
    resource URL, verb name, and any parameters.  There are several special-
    purpose parameters used also:

    onSuccess -- function invoked when request completes. Expects the format
                 didSucceed(status,ajaxRequest,cacheCode,context)
    onFailure -- function invoked when request fails. Same format.
    requestContext -- simply passed back.
    cacheCode -- String indicating the time of the last refresh.
    url -- override the default url building with this url.

    Because some browsers cannot actually perform an HTTP PUT or HTTP DELETE
    it is recommended to perform an HTTP POST with an additional key,value
    pair in the post data packet. For HTTP PUT add _method='put' and for
    HTTP DELETE add _method='delete' in the post data. To have this done for
    you simply add the following to the params hash before calling this
    method:

    {{{
      params.emulateUncommonMethods = true;
    }}}

    @param {String} resource the URL where the collection of the resource
                             can be queried
    @param {String} action the action that should be performed on the resource
    @param {Array} ids array of identifiers of your model instances
    @param {Array} params parameters to control behaviour of this request
    @param {String} method the HTTP method that will be used
  **/
  request: function(resource, action, ids, params, method) {

    // Get Settings and Options
    if (!params) params = {} ;
    var options = {} ;
    var _onSuccess = params._onSuccess; delete params._onSuccess ;
    var _onNotModified = params._onNotModified; delete params._onNotModified ;
    var _onFailure = params._onFailure ; delete params._onFailure ;
    var onSuccess = params.onSuccess ; delete params.onSuccess ;
    var onFailure = params.onFailure ; delete params.onFailure ;
    var context = params.requestContext ; delete params.requestContext ;
    var accept = params.accept ; delete params.accept ;
    var cacheCode = params.cacheCode; delete params.cacheCode ;
    var url = params.url; delete params.url;

    if (!url) {
      var idPart = (ids && ids.length == 1) ? ids[0] : '';
      url = this.urlFormat.format(resource, action) + idPart;
    }

    options.emulateUncommonMethods = params.emulateUncommonMethods; delete params.emulateUncommonMethods ;

    options.requestHeaders = params.requestHeaders ; delete params.requestHeaders ;
    if (!options.requestHeaders) options.requestHeaders = {} ;
    options.requestHeaders['X-SproutCore-Version'] = SC.VERSION ;
    options.requestHeaders['Accept'] = 'application/json, */*' ;
    if (accept) options.requestHeaders['Accept'] = accept ;
    if (cacheCode) options.requestHeaders['Sproutit-Cache'] = cacheCode ;

    options.method = method || 'get' ;

    // handle ids
    if (ids && ids.length > 1) {
      params.ids = [ids].flatten().join(',') ;
    }

    // convert parameters.
    var parameters = this._toQueryString(params) ;
    if (parameters && parameters.length > 0) {
      if (!options.emulateUncommonMethods && options.method == 'delete') {
        // HTTP DELETE doesn't allow a post body; this should actually
        // be handled by prototype..
        url += (url.include('?') ? '&' : '?') + parameters;
      } else {
        options.parameters = parameters;
      }
    }

    var server = this ;
    var request = null ; //will container the ajax request

    // Save callback functions.
    options.onSuccess = function(transport) {
      var cacheCode = request.getHeader('Last-Modified') ;
      var bubble = true;
      if (onSuccess) bubble = (false != onSuccess(transport, cacheCode, context));
      if (bubble && server.onSuccess) bubble = (false != server.onSuccess(transport, cacheCode, context));
      if (bubble) if ((transport.status == '200') && (transport.responseText == '304 Not Modified')) {
        if (_onNotModified) _onNotModified(transport, cacheCode, context);
      } else {
        if (_onSuccess) _onSuccess(transport, cacheCode, context);
      }
    } ;

    options.onFailure = function(transport) {
      var cacheCode = request.getHeader('Last-Modified') ;
      var bubble = true;
      if (onFailure) bubble = (false != onFailure(transport, cacheCode, context));
      if (bubble && server.onFailure) bubble = (false != server.onFailure(transport, cacheCode, context));
      if (bubble && _onFailure) _onFailure(transport, cacheCode, context);
    } ;

    // opts.evalJS == 'force'; // forces evaluation of response

    console.log('REQUEST: %@ %@'.fmt(options.method, url)) ;

    request = new Ajax.Request(url,options) ;
  },


  // RECORD METHODS
  // These methods do the basic record changes.


  /**
    Queries a list of records from a backend server. It is called by a
    collection to get an updated list of records.

    Example usage:

    {{{
      Tasks.server.listFor(MyApp.Task,
                          { order: ['position', 'title'],
                            callback: function(tasks) {
                              MyApp.tasksController.set('content', tasks) ;
                            }
                          }) ;
    }}}

    It is required that the first parameter +recordType+ returns a value for
    property +recordType.resourceURL+ (@see SC.Record#resourceURL). It should
    be a relative URL that points to the location where the collection of
    +recordType+ can be queried.

    The +options+ hash is optional. The following +options+ to customize the
    result are accepted:

    |order| The order in which the results should be returned by the backend
            server. It's either a string like for example 'position, title',
            or an array like for example ['position', 'commentCount']. If an
            array is given each element is decamelized. So the previous
            example would be turned into a request like
            '...&order=position,comment_count'.
            Defaults to value 'id'.
    |conditions| A hash of conditions that the backend should include in it's
                 query. Both keys and values within the hash will be
                 decamelized. A key with name 'guid' will be turned into the
                 key name 'id'.
    |offset| An integer indicating the offset from where the records should be
             queried. So at 10, it would skip the first 9 records.
    |limit| An integer indicating the limit on the number of recors that
            should be returned.
    |onSuccess| A function to be called upon successful retrieval of the
                records from the backend server. The function can take 3
                arguments: records, count, json. The first argument, records,
                is an array of SC.Record objects of the same type as
                specified by the +recordType+ argument. The second argument,
                count, indicates the total count of records matching the
                conditions, but ignoring the offset and limit. The third
                argument, json, contains the complete json response from the
                server.
    |onFailure| A function to be called when a failure occurred. It takes the
                same arguments as the onSuccess handler.

    In addition, all the options that the +request+ method accepts are
    accepted here as well (@see SC.Server#request).

    The backend should return it's result as a JSON hash. The hash should
    contain 3 keys: 'records', 'ids' and 'count'.
    The 'records' value should contain an array of hashes, where each hash
    describes one record. Each hash should at least have the keys 'id'
    and 'type'. The records you return are updated in SC.Store.
    The 'ids' value should be an array of ids referencing ids in your records.
    Only these records will be updated in the collection.
    The 'count' value should indicate the total count of records matching the
    conditions, but ignoring the offset and limit.

    Example:

    {{{
      { 
        records: [ {id:1, type:'Task', title:'1st task'},
                   {id:2, type:'Task', title:'2nd task'},
                   {id:3, type:'Task', title:'3rd task'} ],
        ids: [1,2,3],
        count: 100 
      }
    }}}

    @param {Object} recordType the type of the records to query, subclass of
                    SC.Record. Determines what Model the request is for.
    @param {Hash} options the options to control the behaviour of this method
  **/
  listFor: function(recordType, options) {
    var resource = recordType.resourceURL() ;
    if (!resource) return false ;

    if (!options) options = {} ;

    var order = options.order || 'id' ;
    if (!(order instanceof Array)) order = [order] ;
    order = order.map(function(str){
      return str.decamelize() ; //rubyify
    }).join(',') ;

    var context = {
      recordType: recordType,
      _onSuccess: options._onSuccess,
      _onFailure: options._onFailure,
      onSuccess: options.onSuccess,
      onFailure: options.onFailure
    }

    var params = {} ;
    if (options.conditions) {
      var conditions = this._decamelizeData(options.conditions) ;
      for(var key in conditions) {
        params[key] = conditions[key] ;
      }
    }
    params.requestContext = context ;
    params._onSuccess = this._listSuccess.bind(this) ;
    params._onNotModified = this._listNotModified.bind(this) ;
    params._onFailure = this._listFailure.bind(this) ;
    if (options.cacheCode) params.cacheCode = options.cacheCode ;
    if (options.offset) params.offset = options.offset;
    if (options.limit) params.limit = options.limit ;
    if (order) params.order = order ;
    this.request(resource, this._listForAction, null, params, this._listMethod) ;
  },

  _listForAction: 'list',
  _listMethod: 'get',

  _listSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }
    if (json.records) this.refreshRecordsWithData(json.records, context.recordType, cacheCode, false);

    // next, convert the list of ids into records.
    var recs = (json.ids) ? json.ids.map(function(guid) {
      return SC.Store.getRecordFor(guid,context.recordType) ;
    }) : [] ;

    // invoke internal callback
    if (context._onSuccess) context._onSuccess(recs, json.count, cacheCode) ;

    // invoke custom user callback
    if (context.onSuccess) context.onSuccess(transport, cacheCode, recs, json.count) ;
  },

  _listNotModified: function(transport, cacheCode, context) {
    if (context._onSuccess) context._onSuccess() ;
    if (context.onSuccess) context.onSuccess(transport, cacheCode, null, null) ;
  },

  _listFailure: function(transport, cacheCode, context) {
    console.log('listFailed!') ;
    if (context._onFailure) context._onFailure() ;
    if (context.onFailure) context.onFailure(transport, cacheCode) ;
  },


  // ..........................................
  // CREATE

  // send the records back to create them. added a special parameter to
  // the hash for each record, _guid, which will be used onSuccess.
  createRecords: function(records, options) {
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    records = records.byResourceURL() ; // group by resource.
    for(var resource in records) {
      if (resource == '*') continue ;

      var curRecords = records[resource] ;

      // collect data for records
      var server = this ; var recs = {} ;
      var data = curRecords.map(function(rec) {
        var recData = server._decamelizeData(rec.getPropertyData()) ;
        recData._guid = rec._guid ;
        recs[rec._guid] = rec ;
        return recData ;
      }) ;

      context.records = recs ;
      context.onSuccess = options.onSuccess ;
      context.onFailure = options.onFailure ;

      var params = {
        requestContext: context,
        _onSuccess: this._createSuccess.bind(this),
        _onFailure: this._createFailure.bind(this),
        records: data
      };

      // issue request
      this.request(resource, this._createAction, null, params, this._createMethod) ;
    }
  },

  _createAction: 'create',
  _createMethod: 'post',

  // This method is called when a create is successful.  It first goes through
  // and assigns the primaryKey to each record.
  _createSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }

    // first go through and assign the primaryKey to each record.
    if (json.records) {
      json.records.each(function(data) {
        var guid = data._guid ;
        var rec = (guid) ? context.records[guid] : null ;
        if (rec) {
          var pk = rec.get('primaryKey') ;
          var dataKey = (pk == 'guid') ? 'id' : pk.decamelize().toLowerCase().replace(/\-/g,'_') ;
          rec.set(pk,data[dataKey]) ;
          rec.set('newRecord',false) ;
        }
      }) ;

      // now this method will work so go do it.
      this.refreshRecordsWithData(json.records, context.recordType, cacheCode, true) ;
    }

    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
  },

  _createFailure: function(transport, cacheCode, context) {
    console.log('createFailed!') ;
    if (context.onFailure) context.onFailure(transport, cacheCode) ;
  },


  // ..........................................
  // REFRESH

  refreshRecords: function(records, options) {
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    records = records.byResourceURL() ; // group by resource.
    for(var resource in records) {
      if (resource == '*') continue ;

      var curRecords = records[resource] ;

      // collect resource ids, sort records into hash, and get cacheCode.
      var cacheCode = null ; var ids = [] ;
      var primaryKey = curRecords[0].get('primaryKey') ; // assumes all the same
      curRecords.each(function(r) {
        cacheCode = cacheCode || r._cacheCode ;
        var key = r.get(primaryKey);
        if (key) { ids.push(key); }
      });

      var context = {
        recordType: curRecords[0].recordType, // default record type
        onSuccess: options.onSuccess,
        onFailure: options.onFailure
      };

      var params = {
        requestContext: context,
        cacheCode: ((cacheCode=='') ? null : cacheCode),
        _onSuccess: this._refreshSuccess.bind(this),
        _onFailure: this._refreshFailure.bind(this)
      };

      if (ids.length == 1 && curRecords[0].refreshURL) params['url'] = curRecords[0].refreshURL;

      // issue request
      this.request(resource, this._refreshAction, ids, params, this._refreshMethod) ;
    }
  },

  _refreshAction: 'show',
  _refreshMethod: 'get',

  // This method is called when a refresh is successful.  It expects an array
  // of hashes, which it will convert to records.
  _refreshSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }    
    if (json.records) this.refreshRecordsWithData(json.records, context.recordType, cacheCode, true);
    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
  },

  _refreshFailure: function(transport, cacheCode, context) {
    console.log('refreshFailed!') ;
    if (context.onFailure) context.onFailure(transport, cacheCode) ;
  },

  // ..........................................
  // COMMIT

  commitRecords: function(records, options) {
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    records = records.byResourceURL() ; // group by resource.
    for(var resource in records) {
      if (resource == '*') continue ;

      var curRecords = records[resource] ;

      // collect data for records
      var server = this ;

      // start format differences
      var data = null;
      switch(this.get('postFormat')){
        case SC.URL_ENCODED_FORMAT:
          data = curRecords.map(function(rec) {
            return server._decamelizeData(rec.getPropertyData()) ;
          }) ;
          break;
        case SC.JSON_FORMAT:
          // get all records and put them into an array
          var objects = [];
          for(rec in curRecords){
            if (!curRecords.hasOwnProperty(rec)) continue ;
            objects.push(curRecords[rec].get('attributes') || {});
          }

          // convert to JSON and escape if this.escapeJSON is true
          if(this.get('escapeJSON')){
            data = escape(objects.toJSONString());
          } else {
            data = objects.toJSONString();
          }
          break;
        default:
          break;
      }
      // end format differences

      if (data) {
        var ids = [];
        if (curRecords.length == 1) {
          var primaryKey = curRecords[0].get('primaryKey') ;
          var key = curRecords[0].get(primaryKey);
          if (key) ids.push(key);
        }

        var context = {
          onSuccess: options.onSuccess,
          onFailure: options.onFailure
        };

        var params = {
          requestContext: context,
          _onSuccess: this._commitSuccess.bind(this),
          _onFailure: this._commitFailure.bind(this),
          records: data
        };

        if (ids.length == 1 && curRecords[0].updateURL) params['url'] = curRecords[0].updateURL;

        // issue request
        this.request(resource, this._commitAction, ids, params, this._commitMethod) ;
      }
    }
  },

  _commitAction: 'update',
  _commitMethod: 'post',

  // This method is called when a refresh is successful.  It expects an array
  // of hashes, which it will convert to records.
  _commitSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }
    if (json.records) this.refreshRecordsWithData(json.records, context.recordType, cacheCode, true);
    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
  },

  _commitFailure: function(transport, cacheCode, context) {
    console.log('commitFailed!') ;
    if (context.onFailure) context.onFailure(transport, cacheCode) ;
  },

  // ..........................................
  // DESTROY

  destroyRecords: function(records, options) {
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    var context = {
      onSuccess: options.onSuccess,
      onFailure: options.onFailure
    };

    records = records.byResourceURL() ; // group by resource.
    for(var resource in records) {
      var curRecords = context.records = records[resource] ;

      if (resource == '*') {
        this._destroySuccess(null, null, {records: curRecords}) ;
        continue ;
      }

      // collect resource ids that can be deleted in the backend
      var ids = [] ; var key ;
      var primaryKey = curRecords[0].get('primaryKey') ;
      curRecords.each(function(rec) {
        if ((key = rec.get(primaryKey)) && (!rec.get('newRecord'))) ids.push(key) ;
      }) ;

      if (ids.length == 0) {
        // all records were newRecords
        this._destroySuccess(null, null, {records: curRecords}) ;
        continue;
      }

      var params = {
        requestContext: context,
        _onSuccess: this._destroySuccess.bind(this),
        _onFailure: this._destroyFailure.bind(this)
      };

      if (ids.length == 1 && curRecords[0].destroyURL) params['url'] = curRecords[0].destroyURL;

      this.request(resource, this._destroyAction, ids, params, this._destroyMethod) ;
    }
  },

  _destroyAction: 'destroy',
  _destroyMethod: 'post',

  _destroySuccess: function(transport, cacheCode, context) {
    SC.Store.destroyRecords(context.records);

    if (context.onSuccess) context.onSuccess(transport, cacheCode, context.records);
  },

  _destroyFailure: function(transport, cacheCode, context) {
    console.log('destroyFailed!') ;
    if (context.onFailure) context.onFailure(transport, cacheCode, context.records);
  },

  // ..........................................
  // SUPPORT

  // This method is called by the various handlers once they have extracted
  // their data.
  refreshRecordsWithData: function(dataAry,recordType,cacheCode,loaded) {
    var server = this ;

    // first, prepare each data item in the Ary.
    dataAry = dataAry.map(function(data) {

      // camelize the keys received back.
      data = server._camelizeData(data) ;

      // convert the 'id' property to 'guid'
      if (data.id) { data.guid = data.id; delete data.id; }

      // find the recordType
      if (data.type) {
        var recordName = data.type.capitalize() ;
        if (server.prefix) {
          for (var prefixLoc = 0; prefixLoc < server.prefix.length; prefixLoc++) {
            path = "%@.%@".format(server.prefix[prefixLoc], recordName) ;
            data.recordType = SC.Object.objectForPropertyPath(path) ;
            if (data.recordType) break ;
          }
        } else data.recordType = SC.Object.objectForPropertyPath(recordName) ;

      } else data.recordType = recordType ;

      if (!data.recordType) {
        console.log('skipping undefined recordType:'+recordName) ; 
        return null; // could not process.
      }
      
      return data ;
    }).compact() ;

    // now update.
    SC.Store.updateRecords(dataAry,server,recordType,loaded) ;
  },

  // ................................
  // PRIVATE METHODS

  _camelizeData: function(data) {
    if (data == null) return data ;

    // handle array
    var that = this ;
    if (data instanceof Array) return data.map(function(d){
      return that._camelizeData(d) ;
    }) ;

    // handle other objects
    if (typeof(data) == "object") {
      var ret = {} ;
      for(var key in data) {
        var value = that._camelizeData(data[key]) ;
        if (key == 'id') key = 'guid' ;
        ret[key.replace(/_/g,'-').camelize()] = value ;
      }
      return ret ;
    }

    // otherwise just return value
    return data ;
  },

  _decamelizeData: function(data) {
    if (data == null) return data ;

    // handle array
    var that = this ;
    if (data instanceof Array) return data.map(function(d){
      return that._decamelizeData(d) ;
    }) ;

    // handle other objects
    if (typeof(data) == "object") {
      var ret = {} ;
      for(var key in data) {
        var value = that._decamelizeData(data[key]) ;
        if (key == 'guid') key = 'id' ;
        ret[key.decamelize()] = value ;
      }
      return ret ;
    }

    // otherwise just return value
    return data ;
  },

  // converts a string, array, or hash into a query string.  root is the
  // root string applied to each element key.  Used for nesting.
  _toQueryString: function(params,rootKey) {

    // handle nulls
    if (params == null) {
      return rootKey + '=';

    // handle arrays
    } else if (params instanceof Array) {
      var ret = [] ;
      for(var loc=0;loc<params.length;loc++) {
        var key = (rootKey) ? (rootKey + '['+loc+']') : loc ;
        ret.push(this._toQueryString(params[loc],key)) ;
      }
      return ret.join('&') ;

    // handle objects
    } else if (typeof(params) == "object") {
      var ret = [];
      for(var cur in params) {
        var key = (rootKey) ? (rootKey + '['+cur+']') : cur ;
        ret.push(this._toQueryString(params[cur],key)) ;
      }
      return ret.join('&') ;

    // handle other values
    } else return [rootKey,params].join('=') ;
  }

}) ;
