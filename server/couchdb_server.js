// ========================================================================
// SproutCore
// copyright 2006-2008 Sprout Systems, Inc.
// ========================================================================

require('core') ;
require('server') ;

/**
  @class
  
  couchdbServer gives the ability to use couchdb as a backend for sproutcore
  
  Working so far:
   -  listFor: will make a temp view to get all documents of the type ie. "Contacts.Contact"
   -  listFor: will now take a |view| option, to get data from a couchDB view.
   -  All: uses the bulk_docs options to make/update/delete 1 or more documents on the server.
  
  Todo:
   -  listFor: take an order option (if possible)
   -  refreshRecords: to use cacheing (when usings a predefined view), to enable less traffic (if possible).
   -  requestRecords: clean-up to code that is not used by couchdb
   -  All: enable use of, limit and offset, so that pagenaion will work
   -  All: probably merge common code.
   
   Usage:
   This version loads documents, creates them, updates them (commit), and 
   deletes them. (refresh is still coming) 
   To get it to work, once you have it installed: 
   
   1) edit sc-config, and add this as the last line of the fine: 
   {{{
     proxy '/data', :to => 'localhost:5984', :url => "/database-name" 
   }}}
   '/data' can be whatever you want, this is just the path that SC will 
   look for your data. 
   
   2) Setup the server for your application ie. in core.js: 
   {{{
     Contacts = SC.Object.create({ 
        server: SC.CouchdbServer.create({ prefix: ['Contacts'] }), // This is the important part 
        FIXTURES: [] 
      }) ;
   }}}
   
   3) Set the dataSource for your model, and set a 'type' property. ie.: 
   {{{
     Contacts.Person = SC.Record.extend( 
      ** @scope Contacts.Person.prototype * { 
        dataSource: Contacts.server, 
        // This is the same as you set in the proxy call (note there is no slash at the start) 
        resourceURL: "data", 
        // Then add the name of the default view
        defaultView: "_view/contacts/by_firstname",
        // Make sure that you have a 'type' property, this is how we will separate 
        // your different types of data, and pull them out again. 
        properties: ['type', 'firstName', 'lastName', 'created', 
      'modified'], 
      }) ;
   }}}

   4) if you want to use a different view from the default one, then call listFor with 
      the 'view' option:
   {{{
     Contacts.server.listFor(Contacts.Person, {view: "_view/contacts/by_lastname"}) ;
   }}}

   5) code like you normally would. This is mostly all there is that is 
   different to using SC.Server or SC.RestServer. 
   Of course, this is not finished so there are things that won't work, 
   like offset, limit and conditions. 
   Also it is only using couchdb's temp_views at the moment, the next 
   version will have support for predefined views. 
   Disclaimer: this is a work in progress, and does not yet support all
   couchDB functions.

  @extends SC.Server
  @author Geoffrey Donaldson
  @copyright 2006-2008, Sprout Systems, Inc. and contributors.
  @since SproutCore 0.9.18
*/
SC.CouchdbServer = SC.Server.extend({
  
  request: function(resource, action, ids, params, method) {

    // Get Settings and Options
    if (!params) params = {} ;
    var options = {} ;
    var _onSuccess = params._onSuccess; delete params._onSuccess;
    var _onNotModified = params._onNotModified; delete params._onNotModified ;
    var _onFailure = params._onFailure ; delete params._onFailure ;
    var onSuccess = params.onSuccess; delete params.onSuccess;
    var onFailure = params.onFailure ; delete params.onFailure ;
    var context = params.requestContext ; delete params.requestContext ;
    var accept = params.accept ; delete params.accept ;
    var cacheCode = params.cacheCode; delete params.cacheCode ;
    var url = params.url; delete params.url;

    options.emulateUncommonMethods = params.emulateUncommonMethods; delete params.emulateUncommonMethods ;

    // If params.body is a string, then add it, else JSONfy it
    // This allows us to setup the objects in the calling methods, without toJSONing everywhere.
    if (typeof(params.body) == "string"){
      options.postBody = params.body ;
    }else if(typeof(params.body) == "object"){
      options.postBody = Object.toJSONString(params.body) ;
    } ; delete params.body ;

    options.requestHeaders = params.requestHeaders ; delete params.requestHeaders ;
    if (!options.requestHeaders) options.requestHeaders = {} ;
    options.requestHeaders['Accept'] = 'application/json, */*' ;
    options.requestHeaders['X-SproutCore-Version'] = SC.VERSION ;
    if (accept) options.requestHeaders['Accept'] = accept ;
    if (cacheCode) options.requestHeaders['Sproutit-Cache'] = cacheCode ;
    options.method = method || 'get' ;
    options.contentType = "application/json" // this is needed to make couchdb accept our request.

    // ids are handeled by the calling methods

    // convert remainging parameters into query string.
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
      if (onSuccess) bubble = (false != onSuccess(transport, cacheCode, context)) ;
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

    console.log('REQUEST: %@ %@'.fmt(options.method, url)) ;

    request = new Ajax.Request(url,options) ;
  },

  /* ..........................................
   LIST
    This is the method called by a collection to get an updated list of
    records.

    Options that are different from the standard server, are:

    |view|  This is the full path of the view which you want to access
            View will replace "order".

    |conditions|  should be couchDB query options such as:
                  "count", "startKey" and "endKey".

  */
  listFor: function(recordType, options) {
    var resource = recordType.resourceURL() ;
    if (!resource) return false ;
    if (!options) options = {} ;

    var recordName = recordType.toString() ;// TODO: check if this is needed.
    recordName = recordName.split('.').last() ;
    var call_action = this._listForAction ;
    var url = "" ;

    // check if the user has given a path to a view.
    // if so, call that view (with Method: GET)
    if (options.view || recordType.prototype.get("defaultView").indexOf("_view") != -1){
      if (options.view)
        url = resource + "/" + options.view ;
      else
        url = resource + "/" + recordType.prototype.get("defaultView");
    }else{
      call_action = 'post' ; // we need to post a temp view
      url = resource + "/_temp_view" ;
      var content = {} ;
      // Here is the couchdb temp view code.
      content.map = "function(doc) { " +
        "if (doc.type == \'"+ recordName +"\' ){ "+
          "emit(doc._id, doc)"+
      "}}" ;
    }

    var context = {
      recordType: recordType,
      _onSuccess: options._onSuccess,
      _onFailure: options._onFailure,
      onSuccess: options.onSuccess,
      onFailure: options.onFailure
    } ;

    params = {} ;
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
    params.url = url ;
    params.body = content ;
    this.request(resource, call_action, null, params, this._listForMethod) ;
  },

  _listForAction: 'list', // We don't acually use this with couchdb
  _listForMethod: 'get', // This may be post if we are using _temp_views

  _listSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }

    // Due to the way that couchdb returns data, we need to make our own list of id's,
    // and build the records from the "value" key of each row.
    var ids = []
    var records = json.rows.map(function(row) {
      ids.push(row.id) ;
      //console.log("Got Data - "+Object.toJSONString(row.value)) // for debuging
      return row.value ;
    }) ;

    // then, build any records passed back
    if (records.length > 0) {
      this.refreshRecordsWithData(records,context.recordType,cacheCode,false);
    }

    // next, convert the list of ids into records.
    var recs = (ids) ? ids.map(function(guid) {
      return SC.Store.getRecordFor(guid,context.recordType) ;
    }) : [] ;

    // invoke internal callback
    if (context._onSuccess) context._onSuccess(recs, json.count, cacheCode) ;

    // invoke custom user callback
    if (context.onSuccess) context.onSuccess(transport, cacheCode, recs, json.count) ;
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
      // TODO: possibly change this to work differently with 1 record.
      // but this works with 
      var create_url = resource + "/_bulk_docs" ;

      // collect data for records
      var server = this ; var content = {} ;
      var objects = []; var recs = [] ;

      for (rec in curRecords){
        if (!curRecords.hasOwnProperty(rec)) continue ;
        if (curRecords[rec].get('attributes')){
          atts = curRecords[rec].get('attributes');
          atts.type = curRecords[rec]._type._objectClassName.split('.').last() ;
          //atts._id = curRecords[rec]._guid ; // we don't want to send an id to start with
          delete atts.guid ;
          delete atts.isDirty ; // Not sure what this is or where it comes from
          recs.push(curRecords[rec]) ;
        }else{
          atts = {} ;
        }
        objects.push(atts);
      }
      content.docs = objects ;// request() will call toJSONString() on this. ;

      var context = {
        records: recs,
        onSuccess: options.onSuccess,
        onFailure: options.onFailure
      } ;

      var params = {
        requestContext: context,
        _onSuccess: this._createSuccess.bind(this),
        _onFailure: this._createFailure.bind(this),
        body: content,
        url: create_url
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
    if (json.new_revs) { // couchDB sends back data in the new_revs property
      // CouchDB will return the documents in the same order you sent them
      // so here we walk through the returned id's
      for(i=0; i < json.new_revs.length; i++ ) {
        data = json.new_revs[i] ;
        var rec = context.records[i] ;
        if (rec) {
          var pk = rec.get('primaryKey') ;
          var dataKey = (pk == 'guid') ? 'id' : pk.decamelize().toLowerCase().replace(/\-/g,'_') ;
          rec.set(pk,data[dataKey]) ;
          rec.set("_id", data.id) ;   // Set couchDB specific 
          rec.set("_rev", data.rev) ; // Rev is needed to update a record.
          rec.set('newRecord',false) ;
        }
        context.records[i] = rec ;
      }

      // now this method will work so go do it.
      this.refreshRecordsWithData(context.records, context.recordType, cacheCode, true) ;
    }

    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
  },

  // ..........................................
  // REFRESH
  // WARNING! as couchDB has no way of returning data for many documents,
  // we have to loop through each record. This will be slow!
  // Please use listFor, with a view name, to get fast resaults.
  // This is only good for prototyping, demos or just a handful of documents.
  refreshRecords: function(records, options) {
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;
    
    records.each(function(r) {
      var primaryKey = r.get('primaryKey') ;
      var context = {
        recordType: r.recordType, // default record type
        onSuccess: options.onSuccess,
        onFailure: options.onFailure
      };
      var params = {
        url: r.get('resourceURL')+"/"+r.get(primaryKey),
        requestContext: context,
        _onSuccess: this._refreshSuccess.bind(this),
        _onFailure: this._refreshFailure.bind(this)
      };
      // issue request
      this.request(resource, this._refreshAction, [r.get(primaryKey)], params, this._refreshMethod) ;
    });
    
  },

  _refreshAction: '',
  _refreshMethod: 'get',
  
  _refreshSuccess: function(transport, cacheCode, context) {
    
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }

    // we are only getting one back at a time atm, so stick it in.
    var ids = [json._id]
    var records = [json]

    // then, build any records passed back
    if (records.length > 0) {
      this.refreshRecordsWithData(records,context.recordType,cacheCode,false);
    }

    // invoke custom user callback
    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
    
  },

  // ..........................................
  // COMMIT
  // This is mostly just a copy of createRecords, as the process is the same
  // in couchDB

  commitRecords: function(records, options) { 
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    records = records.byResourceURL() ; // sort by resource.
    for(var resource in records) {
      if (resource == '*') continue ;

      var curRecords = records[resource] ;
      // TODO: possibly change this to work differently with 1 record.
      // but this works with 
      var create_url = resource + "/_bulk_docs" ;

      // collect data for records
      var server = this ; var content = {} ;
      var objects = []; var recs = [] ;

      for (rec in curRecords){
        if (!curRecords.hasOwnProperty(rec)) continue ;
        if (curRecords[rec].get('attributes')){
          atts = curRecords[rec].get('attributes');
          atts._id = curRecords[rec].get('guid') ;
          recs.push(curRecords[rec]) ;
        }else{
          atts = {} ;
        }
        objects.push(atts);
      }
      content.docs = objects ;// request() will call toJSONString() on this. ;

      if (content.docs.length > 0) {
        var context = {
          records: recs,
          onSuccess: options.onSuccess,
          onFailure: options.onFailure
        } ;

        var params = {
          requestContext: context,
          _onSuccess: this._commitSuccess.bind(this),
          _onFailure: this._commitFailure.bind(this),
          body: content,
          url: create_url
        };

        // issue request
        this.request(resource, this._createAction, null, params, this._createMethod) ;
      }
    }
  },

  _commitAction: 'save',
  _commitMethod: 'post', // again, this will use couchDB's bulk_docs call, which is post

  // This method is called when a refresh is successful.  It expects an array
  // of hashes, which it will convert to records.
  _commitSuccess: function(transport, cacheCode, context) {
    var json = eval('json='+transport.responseText) ;
    if (!json) { console.log('invalid json!'); return; }

    // first go through and assign the primaryKey to each record.
    if (json.new_revs) {
      // CouchDB will return the documents in the same order you sent them
      // so here we walk through the returned id's
      for(i=0; i < json.new_revs.length; i++ ) {
        var data = json.new_revs[i] ;
        var rec = context.records[i] ;
        if (rec) {
          var pk = rec.get('primaryKey') ;
          var dataKey = (pk == 'guid') ? 'id' : pk.decamelize().toLowerCase().replace(/\-/g,'_') ;
          rec.set(pk,data[dataKey]) ;
          rec.set("_id", data.id) ;   // Set couchDB specific 
          rec.set("_rev", data.rev) ;
          rec.set('newRecord',false) ;
        }
        context.records[i] = rec ;
      }

      // now this method will work so go do it.
      this.refreshRecordsWithData(context.records, context.recordType, cacheCode, true) ;
    }

    if (context.onSuccess) context.onSuccess(transport, cacheCode) ;
  },

  // ..........................................
  // DESTROY
  // And once again, this is almost a copy of commit 
  // ... I wonder if there is a way to make this cleaner

  destroyRecords: function(records, options) { 
    if (!records || records.length == 0) return ;
    if (!options) options = {} ;

    records = records.byResourceURL() ; // sort by resource.
    for(var resource in records) {
      var curRecords = records[resource] ;
      
      if (resource == '*') {
        this._destroySuccess(null, null, {records: curRecords}) ;
        continue ;
      }

      // TODO: possibly change this to work differently with 1 record.
      // but this works with 
      var create_url = resource + "/_bulk_docs" ;

      // collect data for records
      var server = this ; var content = {} ;
      var objects = []; 

      for (rec in curRecords){
        if (!curRecords.hasOwnProperty(rec)) continue ;
        if (curRecords[rec].get('attributes')){
          atts = curRecords[rec].get('attributes');
          atts._id = curRecords[rec].get('guid') ;
          atts._deleted = true ;
        }else{
          atts = {} ;
        }
        objects.push(atts);
      }
      content.docs = objects ;// request() will call toJSONString() on this. ;

      if (content.docs.length > 0) {
        var context = {
          records: curRecords,
          onSuccess: options.onSuccess,
          onFailure: options.onFailure
        } ;

        var params = {
          requestContext: context,
          _onSuccess: this._destroySuccess.bind(this),
          _onFailure: this._destroyFailure.bind(this),
          body: content,
          url: create_url
        };

        // issue request
        this.request(resource, this._destroyAction, null, params, this._destroyMethod) ;
      }
    }
  },

  _destroyAction: 'destroy',
  _destroyMethod: 'post', // We are using post to couchdb's _bulk_doc page.

  // ..........................................
  // SUPPORT

  // This method is called by the various handlers once they have extracted
  // their data.
  refreshRecordsWithData: function(dataAry,recordType,cacheCode,loaded) {
    var server = this ;

    // first, prepare each data item in the Ary.
    dataAry = dataAry.map(function(data) {

      // convert the '_id' property to 'guid' to keep the id's that couchdb has given
      if (data._id) { 
        data.guid = data._id; delete data._id; 
      }else if (data.id) {
        data.guid = data.id; delete data.id;
      }
      if (data.rev) {
        data._rev = data.rev; delete data.rev ;
      }

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
  }
  
}) ;
